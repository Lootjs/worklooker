import { sourcePublished } from "./dates.js";
import { fetchText, HttpError } from "./http.js";
import { decodeEntities, htmlToText, tidyLines } from "./text.js";
import type { RatedVacancy, Source, Vacancy } from "./types.js";
import { isVacancyUrl, maxSnippetLength, sourceVacancy } from "./vacancy.js";

/**
 * Sources that publish schema.org JSON-LD in their server-rendered HTML: a
 * `JobPosting` on each vacancy page and, ideally, an `ItemList` of vacancies
 * on listing pages. Plain HTTP is enough, so these sources skip the browser.
 */

type JsonLdNode = Record<string, unknown> & { "@type"?: string | string[] };

interface ListItem {
  name?: string;
  url?: string;
  description?: string;
}

interface Place {
  address?: { addressLocality?: string; addressCountry?: string | { name?: string } };
}

interface JobPosting {
  title?: string;
  description?: string;
  datePosted?: string;
  jobLocationType?: string;
  jobLocation?: Place | Place[];
  hiringOrganization?: { name?: string };
  applicantLocationRequirements?: { name?: string } | Array<{ name?: string }>;
  baseSalary?: { currency?: string; value?: { minValue?: number; maxValue?: number; unitText?: string } };
}

// Built In sits behind Cloudflare: parallel requests get HTTP 429 and then a
// challenge page. Read vacancy pages one at a time with a pause.
const detailPauseMs = 500;
// Some sites escape `+` in the type attribute as `&#x2B;`.
const jsonLdScript = /<script[^>]*type=["']application\/ld(?:\+|&#x2B;|&#43;)json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** Every JSON-LD node on the page, with `@graph` containers flattened. */
function jsonLdNodes(html: string): JsonLdNode[] {
  return [...html.matchAll(jsonLdScript)].flatMap(([, body]) => {
    try {
      const parsed = JSON.parse(body) as JsonLdNode | JsonLdNode[];
      return (Array.isArray(parsed) ? parsed : [parsed]).flatMap((node) => Array.isArray(node["@graph"]) ? node["@graph"] as JsonLdNode[] : [node]);
    } catch {
      return [];
    }
  });
}

function nodeOfType<T>(nodes: JsonLdNode[], type: string): T | undefined {
  return nodes.find((node) => [node["@type"]].flat().includes(type)) as T | undefined;
}

/** Vacancy links on a listing page without an `ItemList`: titles only. */
function linkedVacancies(html: string, pageUrl: string, source: Source): Array<{ url: string; title: string }> {
  return [...html.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].flatMap(([, href, inner]) => {
    const url = new URL(decodeEntities(href), pageUrl);
    return isVacancyUrl(source, url)
      ? [{ url: url.href, title: decodeEntities(inner.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() }]
      : [];
  });
}

/**
 * Reads the listing pages in order and stops at the first one without
 * vacancies, so spare pages in `extraUrls` cost one request at most. A first
 * page without an `ItemList` falls back to its vacancy links, which carry
 * titles only; `summaries` tells the caller which case it got.
 */
async function listVacancies(source: Source): Promise<{ vacancies: Vacancy[]; summaries: boolean }> {
  const seen = new Set<string>();
  const vacancies: Vacancy[] = [];
  const add = (url: string, title: string, snippet: string) => {
    if (!title || seen.has(url) || !isVacancyUrl(source, url)) return;
    seen.add(url);
    vacancies.push(sourceVacancy(source, { title, url, snippet }));
  };
  for (const [index, pageUrl] of [source.url, ...(source.extraUrls ?? [])].entries()) {
    const html = await fetchText(pageUrl);
    const items = nodeOfType<{ itemListElement?: ListItem[] }>(jsonLdNodes(html), "ItemList")?.itemListElement;
    if (!items && index === 0) {
      for (const link of linkedVacancies(html, pageUrl, source)) add(link.url, link.title, "");
      return { vacancies, summaries: false };
    }
    if (!items?.length) break;
    for (const item of items) {
      if (item.name && item.url) add(new URL(item.url, pageUrl).href, item.name.trim(), tidyLines(item.description ?? ""));
    }
  }
  // An ItemList of names alone (HireHi) says no more than links do.
  return { vacancies, summaries: vacancies.some((vacancy) => vacancy.snippet) };
}

/**
 * Collects and rates a JSON-LD source. With listing summaries, only vacancies
 * that pass the profile get their JobPosting, and are rated again on it. A
 * listing of bare titles says too little to rate, so every vacancy whose
 * title `titleCheck` accepts gets its JobPosting first.
 */
export async function collectJsonLd(
  source: Source,
  rate: (vacancies: Vacancy[]) => RatedVacancy[],
  titleCheck: (title: string) => boolean = () => true,
): Promise<RatedVacancy[]> {
  const { vacancies, summaries } = await listVacancies(source);
  // Titles alone cannot show the work format, so they only pick which pages to open.
  return rate(await withJobPostings(summaries ? rate(vacancies) : vacancies.filter((vacancy) => titleCheck(vacancy.title))));
}

/** One line of working conditions: format, location, who may apply, salary. */
function conditions(posting: JobPosting): string {
  const countries = [posting.applicantLocationRequirements ?? []].flat().map((place) => place.name).filter(Boolean);
  const salary = posting.baseSalary?.value;
  const places = [posting.jobLocation ?? []].flat().map(({ address }) => {
    const country = typeof address?.addressCountry === "string" ? address.addressCountry : address?.addressCountry?.name;
    return [address?.addressLocality, country].filter(Boolean).join(", ");
  }).filter(Boolean);
  return [
    posting.jobLocationType === "TELECOMMUTE" ? "Remote" : undefined,
    places.length ? [...new Set(places)].join("; ") : undefined,
    countries.length ? `Applicants from: ${countries.join(", ")}` : undefined,
    salary?.minValue || salary?.maxValue
      ? `${posting.baseSalary?.currency ?? ""} ${[salary.minValue, salary.maxValue].filter(Boolean).join("–")}${salary.unitText ? ` / ${salary.unitText.toLowerCase()}` : ""}`.trim()
      : undefined,
  ].filter(Boolean).join(" · ");
}

/**
 * Replaces the listing summary with the vacancy page's JobPosting: title,
 * company, working conditions and the full description. A page that fails to load
 * keeps its listing summary rather than failing the source.
 */
export async function withJobPostings<T extends Vacancy>(vacancies: T[]): Promise<T[]> {
  const enriched = [...vacancies];
  for (const [index, vacancy] of vacancies.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, detailPauseMs));
    try {
      const posting = nodeOfType<JobPosting>(jsonLdNodes(await fetchText(vacancy.url)), "JobPosting");
      if (!posting) continue;
      const title = posting.title ? decodeEntities(posting.title).trim() : "";
      const company = posting.hiringOrganization?.name?.trim();
      const snippet = [conditions(posting), htmlToText(posting.description ?? "")].filter(Boolean).join("\n\n");
      // Only TELECOMMUTE is explicit; sites often omit the field for office jobs.
      const remote = posting.jobLocationType === "TELECOMMUTE" ? { remote: true } : {};
      enriched[index] = { ...vacancy, ...(title ? { title } : {}), ...(company ? { company } : {}), ...remote, ...sourcePublished(posting.datePosted), snippet: (snippet || vacancy.snippet).slice(0, maxSnippetLength) };
    } catch (error) {
      // Rate-limited: stop asking, the rest keep their listing summaries.
      if (error instanceof HttpError && error.status === 429) break;
    }
  }
  return enriched;
}
