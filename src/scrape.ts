import { chromium, type Browser, type Page } from "playwright";
import type { Source, Vacancy } from "./types.js";

type LinkCandidate = { href: string; text: string; title?: string; company?: string };

// JavaScript's `\b` only understands ASCII, so Cyrillic words need explicit
// Unicode boundaries.
// A capitalised first and last name, followed by a role. The name check must be
// case-sensitive and the role check case-insensitive, so they are separate.
const authorName = /^([А-ЯЁ][а-яё-]+\s+[А-ЯЁ][а-яё-]+)\s+/u;
const roleStart = /^(?:head\s+of|frontend|front-end|tech(?:nical)?\s+lead|cto|senior|staff|principal|lead|middle|разработчик[а-яё]*|фронтенд[а-яё]*|техлид[а-яё]*|руководител[а-яё]*)(?![\p{L}\p{N}_])/iu;
function authorOf(text: string): string | undefined {
  const match = text.match(authorName);
  return match && roleStart.test(text.slice(match[0].length)) ? match[1] : undefined;
}
const titleBoundary = /[📍💎🚀]|(?<![\p{L}\p{N}_])(?:remote|удал[её]н|опыт|experience|требован|команда|услови)/iu;
const digestPattern = /(?:^|\s)#(?:дайджест|digest)(?=\s|$)|(?:^|\n)\s*(?:подборка\s+вакансий|дайджест\s+вакансий|вакансии\s+за)/im;
const defaultHistoryPages = 5;
const detailPauseMs = 1_000;
const detailRetryBackoffMs = [4_000, 10_000];

function absoluteUrl(href: string, baseUrl: string): string | undefined {
  try {
    const url = new URL(href, baseUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Collapses spaces inside lines but keeps line breaks, at most one blank line in a row. */
export function tidyLines(text: string): string {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Matches a phrase whatever whitespace, including line breaks, separates its words. */
function phrasePattern(phrase: string, flags = ""): RegExp {
  return new RegExp(phrase.trim().split(/\s+/).map(escapeRegExp).join(String.raw`\s+`), flags);
}

function formatVacancyText(text: string, sourceName: string): Pick<Vacancy, "title" | "author" | "snippet"> {
  const body = tidyLines(text)
    .replace(/^\d{1,2}:\d{2}\s+/, "")
    .replace(new RegExp(String.raw`^${phrasePattern(sourceName).source}\s+`, "i"), "")
    .replace(/^(?:#[\p{L}\d_]+\s*)+/u, "")
    .replace(/^(?:→\s*)?(?:откликнуться\s+)?тут\s+/i, "")
    .trim();
  // Title and author are found on one flattened line; the description keeps its lines.
  const raw = body.replace(/\s+/g, " ");
  // Telegram messages often begin with a person's name and then the role.
  // Treat that name as metadata, rather than letting it compete with the job title.
  const author = authorOf(raw);
  const titleStart = author ? raw.slice(author.length).trim() : raw;
  const boundary = titleStart.search(titleBoundary);
  const title = titleStart.slice(0, boundary > 20 ? boundary : 120).trim();
  const snippet = tidyLines(body
    .replace(title ? phrasePattern(title, "g") : /$^/, "")
    .replace(author ? phrasePattern(author) : /$^/, ""));
  return { title: title || raw.slice(0, 120), ...(author ? { author } : {}), snippet: snippet.slice(0, 1_200) };
}

/**
 * A listing card holds short metadata (location, salary, format, date), one
 * element per line. Join it into one line, without the title and company that
 * the card already shows, or logo initials.
 */
function cardDetails(text: string, shown: Array<string | undefined>): string {
  const hidden = new Set(shown.filter(Boolean).map((value) => value!.replace(/\s+/g, " ").trim().toLowerCase()));
  return tidyLines(text)
    .split("\n")
    // A line may prefix the title with a flag or emoji, so long values match as
    // substrings; short ones (a company like "AR") only as the whole line.
    .filter((line) => line.length > 2 && ![...hidden].some((value) => value.length >= 6 ? line.toLowerCase().includes(value) : line.toLowerCase() === value))
    .join(" · ")
    .slice(0, 1_200);
}

function uniqueByUrl(candidates: LinkCandidate[], source: Source): Vacancy[] {
  const seen = new Set<string>();
  return candidates.flatMap(({ href, text, title, company }) => {
    const url = absoluteUrl(href, source.url);
    const cleaned = text.replace(/\s+/g, " ").trim();
    // A digest is a bundle of several jobs: keeping it as one vacancy would
    // make the title, score and destination link misleading.
    if (!url || !cleaned || digestPattern.test(text) || seen.has(url)) return [];
    const pathname = new URL(url).pathname;
    // Only preserve a known vacancy detail URL. In a Telegram post, this is
    // the permalink to the post itself — never one of its incidental links.
    if (!source.vacancyPathPatterns.some((pattern) => pattern.test(pathname))) return [];
    // Avoid menu and result-page links that happen to match broadly.
    if (pathname === new URL(source.url).pathname) return [];
    // Structured cards already name the title; only free text needs guessing.
    const formatted = title
      ? { title: title.replace(/\s+/g, " ").trim(), snippet: cardDetails(text, [title, company]) }
      : formatVacancyText(text, source.name);
    seen.add(url);
    return [{
      source: source.id,
      sourceName: source.name,
      title: formatted.title,
      author: "author" in formatted ? formatted.author : undefined,
      ...(company?.trim() ? { company: company.trim() } : {}),
      url,
      snippet: formatted.snippet,
      remoteByDefault: source.remoteByDefault,
      fetchedAt: new Date().toISOString(),
    }];
  });
}

async function open(page: Page, url: string): Promise<void> {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  if (!response || response.status() >= 400) {
    throw new Error(`сайт вернул HTTP ${response?.status() ?? "без ответа"}`);
  }
}

/** Reads the newest posts, then follows the preview's "older posts" link. */
async function scrapeTelegramPreview(page: Page, source: Source): Promise<LinkCandidate[]> {
  const messages: LinkCandidate[] = [];
  let url: string | undefined = source.url;
  for (let pageIndex = 0; url && pageIndex < (source.historyPages ?? defaultHistoryPages); pageIndex += 1) {
    await open(page, url);
    // Channels with the web preview disabled redirect from /s/handle to /handle.
    if (!new URL(page.url()).pathname.startsWith("/s/")) {
      throw new Error("канал закрыл веб-превью, читать его можно только через Telegram-клиент");
    }
    messages.push(...await page.locator(".tgme_widget_message").evaluateAll((items) =>
      items.flatMap((item) => {
        const permalink = item.querySelector("a.tgme_widget_message_date") as HTMLAnchorElement | null;
        const messageText = item.querySelector(".tgme_widget_message_text") as HTMLElement | null;
        const text = messageText?.innerText.trim() ?? "";
        return permalink?.href && text ? [{ href: permalink.href, text }] : [];
      }),
    ));
    const older = await page.locator('a.tme_messages_more[href*="before="]').first().getAttribute("href", { timeout: 1_000 }).catch(() => null);
    url = older ? new URL(older, page.url()).href : undefined;
  }
  return messages;
}

async function scrapeListing(page: Page, source: Source, url: string): Promise<LinkCandidate[]> {
  await open(page, url);
  if (source.waitForSelector) await page.waitForSelector(source.waitForSelector, { timeout: 20_000 });
  else await page.waitForTimeout(2_000);

  if (source.card) {
    const { item, title, company } = source.card;
    return page.locator(item).evaluateAll((cards, selectors) =>
      cards.flatMap((card) => {
        const titleElement = card.querySelector(selectors.title) as HTMLElement | null;
        // A card may be the link itself, with the title as a heading inside it.
        const link = (card instanceof HTMLAnchorElement ? card : titleElement) as HTMLAnchorElement | null;
        if (!titleElement || !link?.href) return [];
        const companyText = selectors.company ? (card.querySelector(selectors.company) as HTMLElement | null)?.innerText : undefined;
        return [{ href: link.href, title: titleElement.innerText, company: companyText, text: (card as HTMLElement).innerText }];
      }), { title, company });
  }

  const candidates = await page.locator("a[href]").evaluateAll((anchors) =>
    anchors.map((anchor) => {
      const element = anchor as HTMLAnchorElement;
      const card = element.closest("article, li, [role=listitem]") ?? element.parentElement;
      return {
        href: element.href,
        text: ((element as HTMLElement).innerText || element.textContent || "").trim(),
        cardText: ((card as HTMLElement | null)?.innerText || "").trim(),
      };
    }),
  );
  return candidates.map(({ href, text, cardText }) => ({ href, text: `${text}\n${cardText}` }));
}

/**
 * Adds the full description from each vacancy page to the card metadata. A
 * page that fails to load keeps its listing snippet rather than failing the source.
 */
export async function withDetailDescriptions<T extends Vacancy>(source: Source, vacancies: T[], browser: Browser): Promise<T[]> {
  const selector = source.detailDescription;
  if (!selector || !vacancies.length) return vacancies;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  try {
    const page = await context.newPage();
    const enriched: T[] = [];
    for (const [index, vacancy] of vacancies.entries()) {
      // GeekJob rate-limits bursts: it answers HTTP 200 with its own
      // "503 · Сервис временно недоступен" page, which has no description.
      // Space the requests out and back off before retrying.
      if (index > 0) await page.waitForTimeout(detailPauseMs);
      let description = "";
      for (const backoff of [0, ...detailRetryBackoffMs]) {
        if (backoff) await page.waitForTimeout(backoff);
        try {
          await open(page, vacancy.url);
          description = tidyLines(await page.locator(selector).first().innerText({ timeout: 5_000 }));
          break;
        } catch {
          // Keep the listing snippet if every attempt fails.
        }
      }
      enriched.push(description ? { ...vacancy, snippet: [vacancy.snippet, description].filter(Boolean).join("\n\n").slice(0, 4_000) } : vacancy);
    }
    return enriched;
  } finally {
    await context.close();
  }
}

/**
 * Fetches visible vacancy-card links. The generic extractor avoids depending on
 * undocumented site APIs. Pass a shared browser when collecting many sources.
 */
export async function scrapeSource(source: Source, sharedBrowser?: Browser): Promise<Vacancy[]> {
  const browser = sharedBrowser ?? await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  try {
    const page = await context.newPage();
    if (new URL(source.url).hostname === "t.me") return uniqueByUrl(await scrapeTelegramPreview(page, source), source);

    const candidates: LinkCandidate[] = [];
    for (const url of [source.url, ...(source.extraUrls ?? [])]) candidates.push(...await scrapeListing(page, source, url));
    return uniqueByUrl(candidates, source);
  } finally {
    await context.close();
    if (!sharedBrowser) await browser.close();
  }
}
