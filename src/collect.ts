import { chromium, type Browser } from "playwright";
import { scrapeAshby } from "./ashby.js";
import { isStale } from "./dates.js";
import { scrapeGreenhouse } from "./greenhouse.js";
import { readProfile } from "./local-config.js";
import { createRater } from "./match.js";
import { scrapePeopleForce } from "./peopleforce.js";
import { scrapeRss } from "./rss.js";
import { scrapeSource, withDetailDescriptions } from "./scrape.js";
import { SourceTally, saveSourceReport } from "./source-reports.js";
import { activeSourceIds, enabledSources, isSourceEnabled, wantApplyBotSource } from "./sources.js";
import { mergeSourceVacancies, pruneInactiveSources } from "./store.js";
import { collectJsonLd } from "./structured-data.js";
import { scrapeWantApplyBot, wantApplyBotIsReady } from "./telegram.js";
import { scrapeTildaFeed } from "./tilda.js";
import { scrapeTribe } from "./tribe.js";
import type { RatedVacancy, Source, Vacancy } from "./types.js";

/** A source that could not be collected, and why. */
export interface CollectionError {
  sourceId: string;
  sourceName: string;
  message: string;
}

export interface CollectionResult {
  vacancies: RatedVacancy[];
  errors: CollectionError[];
}

/** Progress events; the API streams them to the browser as NDJSON lines. */
export type CollectionEvent =
  | { type: "start"; total: number }
  | { type: "source"; sourceId: string; sourceName: string; done: number; total: number; matched: number; added: number; error?: string }
  | { type: "done"; matched: number; added: number; errors: CollectionError[] }
  /** The collection as a whole failed; sent by the API, not by `collectVacancies`. */
  | { type: "error"; message: string };

type Rate = (vacancies: Vacancy[]) => RatedVacancy[];
/** Reads one source and rates what it finds; returns the vacancies that passed. */
type Collector = (source: Source, rate: Rate, browser: Browser) => Promise<RatedVacancy[]>;

const readThenRate = (read: (source: Source) => Promise<Vacancy[]>): Collector => async (source, rate) => rate(await read(source));

/** How to read each kind of source; a source without `format` is rendered in the browser. */
const collectors: Record<NonNullable<Source["format"]> | "browser", Collector> = {
  rss: readThenRate(scrapeRss),
  tribe: readThenRate(scrapeTribe),
  "tilda-feed": readThenRate(scrapeTildaFeed),
  peopleforce: readThenRate(scrapePeopleForce),
  greenhouse: readThenRate(scrapeGreenhouse),
  ashby: readThenRate(scrapeAshby),
  // Decides itself which vacancy pages to read before rating.
  "json-ld": (source, rate) => collectJsonLd(source, rate),
  browser: async (source, rate, browser) => {
    const matched = rate(await scrapeSource(source, browser));
    // Listing cards may hold only metadata: fetch the full description for
    // the vacancies that passed, and rate them again on the complete text.
    return source.detailDescription ? rate(await withDetailDescriptions(source, matched, browser)) : matched;
  },
};

/**
 * Formats whose answer is the employer's own list of openings: an empty one
 * means no openings. A page or channel that shows nothing is more likely a
 * captcha, a login wall or a changed layout.
 */
const trustedEmptyFormats = new Set<Source["format"]>(["rss", "tribe", "tilda-feed", "peopleforce", "greenhouse", "ashby"]);

/** Sources read several pages each, so cap how many run at once. */
const concurrency = 6;

async function runWithLimit(tasks: Array<() => Promise<void>>, limit: number): Promise<void> {
  let next = 0;
  async function worker(): Promise<void> {
    while (next < tasks.length) await tasks[next++]();
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Collects public sources, and the private bot only after local Telegram
 * setup. Each source is saved as soon as it finishes, so its vacancies can be
 * reviewed while slower sources are still running.
 */
export async function collectVacancies(onEvent: (event: CollectionEvent) => void = () => {}): Promise<CollectionResult> {
  // Read per run, so profile edits apply without restarting the server.
  const { profile, isExample } = readProfile();
  if (isExample) console.warn("Профиль не настроен: используется worklooker.example.json. Создайте worklooker.local.json (см. README).");
  const rateVacancy = createRater(profile);
  const browser = await chromium.launch({ headless: true });
  try {
    const tasks: Array<{ source: Source; collect: Collector }> = enabledSources().map((source) => ({ source, collect: collectors[source.format ?? "browser"] }));
    const botEnabled = isSourceEnabled(wantApplyBotSource.id);
    // The bot chat is the user's own account: an empty chat is genuinely empty.
    if (botEnabled && await wantApplyBotIsReady()) tasks.push({ source: wantApplyBotSource, collect: readThenRate(scrapeWantApplyBot) });
    onEvent({ type: "start", total: tasks.length });

    const errors: CollectionError[] = [];
    const vacancies: RatedVacancy[] = [];
    let done = 0;
    let added = 0;
    await runWithLimit(tasks.map(({ source, collect }) => async () => {
      let matched: RatedVacancy[] = [];
      let error: string | undefined;
      let sourceAdded = 0;
      // Every verdict is counted, so the sources view can explain what was filtered out.
      const tally = new SourceTally();
      const rate: Rate = (found) => found.flatMap((vacancy) => {
        if (source.keepsClosedPosts && isStale(vacancy.publishedAt, profile.maxAgeDays)) {
          tally.record(vacancy, { dropped: "stale" });
          return [];
        }
        const verdict = rateVacancy(vacancy);
        tally.record(vacancy, verdict);
        return "vacancy" in verdict ? [verdict.vacancy] : [];
      });
      try {
        matched = await collect(source, rate, browser);
        // Merging an empty list would clear the source's queue; keep it and say why instead.
        if (!tally.found && source !== wantApplyBotSource && !trustedEmptyFormats.has(source.format)) {
          throw new Error("источник не отдал ни одной вакансии: возможно, капча, вход или изменилась вёрстка");
        }
        sourceAdded = (await mergeSourceVacancies(source.id, matched)).added;
      } catch (reason) {
        matched = [];
        error = errorMessage(reason);
        errors.push({ sourceId: source.id, sourceName: source.name, message: error });
      }
      // A report that fails to save must not fail the collection.
      await saveSourceReport(tally.report(source.id, sourceAdded, error)).catch((reason) => console.warn(`Отчёт источника ${source.name} не сохранён: ${errorMessage(reason)}`));
      vacancies.push(...matched);
      added += sourceAdded;
      done += 1;
      onEvent({ type: "source", sourceId: source.id, sourceName: source.name, done, total: tasks.length, matched: matched.length, added: sourceAdded, ...(error ? { error } : {}) });
    }), concurrency);

    // Undecided cards of removed or switched-off sources leave the queue.
    await pruneInactiveSources(activeSourceIds());
    vacancies.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    onEvent({ type: "done", matched: vacancies.length, added, errors });
    return { vacancies, errors };
  } finally {
    await browser.close();
  }
}
