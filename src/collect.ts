import { chromium } from "playwright";
import { readProfile } from "./local-config.js";
import { createRater } from "./match.js";
import { enabledSources, isSourceEnabled, wantApplyBotSource } from "./sources.js";
import { scrapeSource, withDetailDescriptions } from "./scrape.js";
import { scrapeAshby } from "./ashby.js";
import { scrapeGreenhouse } from "./greenhouse.js";
import { scrapePeopleForce } from "./peopleforce.js";
import { scrapeRss } from "./rss.js";
import { collectJsonLd } from "./structured-data.js";
import { scrapeTildaFeed } from "./tilda.js";
import { scrapeTribe } from "./tribe.js";
import { mergeSourceVacancies, pruneRemovedSources } from "./store.js";
import { scrapeWantApplyBot, wantApplyBotIsReady } from "./telegram.js";
import { isStale } from "./dates.js";
import { SourceTally, saveSourceReport } from "./source-reports.js";
import type { RatedVacancy, Source, Vacancy } from "./types.js";

export interface CollectionResult {
  vacancies: RatedVacancy[];
  errors: string[];
}

/** Progress events; the API streams them to the browser as NDJSON lines. */
export type CollectionEvent =
  | { type: "start"; total: number }
  | { type: "source"; sourceId: string; sourceName: string; done: number; total: number; matched: number; added: number; error?: string }
  | { type: "done"; matched: number; added: number; errors: string[] };

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
    const tasks: Array<{ source: Source; collect: () => Promise<Vacancy[]> }> = enabledSources().map((source) => ({
      source,
      collect: () => source.format === "rss" ? scrapeRss(source)
        : source.format === "tribe" ? scrapeTribe(source)
        : source.format === "tilda-feed" ? scrapeTildaFeed(source)
        : source.format === "peopleforce" ? scrapePeopleForce(source)
        : source.format === "greenhouse" ? scrapeGreenhouse(source)
        : source.format === "ashby" ? scrapeAshby(source)
        : scrapeSource(source, browser),
    }));
    if (isSourceEnabled(wantApplyBotSource.id) && await wantApplyBotIsReady()) tasks.push({ source: wantApplyBotSource, collect: scrapeWantApplyBot });
    onEvent({ type: "start", total: tasks.length });

    const errors: string[] = [];
    const vacancies: RatedVacancy[] = [];
    let done = 0;
    let added = 0;
    await runWithLimit(tasks.map(({ source, collect }) => async () => {
      let matched: RatedVacancy[] = [];
      let error: string | undefined;
      let sourceAdded = 0;
      // Every verdict is counted, so the sources view can explain what was filtered out.
      const tally = new SourceTally();
      try {
        const rate = (vacancies: Vacancy[]): RatedVacancy[] => vacancies.flatMap((vacancy) => {
          if (source.keepsClosedPosts && isStale(vacancy.publishedAt, profile.maxAgeDays)) {
            tally.record(vacancy, { dropped: "stale" });
            return [];
          }
          const verdict = rateVacancy(vacancy);
          tally.record(vacancy, verdict);
          return "vacancy" in verdict ? [verdict.vacancy] : [];
        });
        if (source.format === "json-ld") {
          // Decides itself which vacancy pages to read before rating.
          matched = await collectJsonLd(source, rate);
        } else {
          matched = rate(await collect());
          // Listing cards may hold only metadata: fetch the full description for
          // the vacancies that passed, and rate them again on the complete text.
          if (source.detailDescription) matched = rate(await withDetailDescriptions(source, matched, browser));
        }
        sourceAdded = (await mergeSourceVacancies(source.id, matched)).added;
      } catch (reason) {
        error = errorMessage(reason);
        errors.push(`${source.name}: ${error}`);
      }
      // A report that fails to save must not fail the collection.
      await saveSourceReport(tally.report(source.id, matched.length, sourceAdded, error)).catch((reason) => console.warn(`Отчёт источника ${source.name} не сохранён: ${errorMessage(reason)}`));
      vacancies.push(...matched);
      added += sourceAdded;
      done += 1;
      onEvent({ type: "source", sourceId: source.id, sourceName: source.name, done, total: tasks.length, matched: matched.length, added: sourceAdded, ...(error ? { error } : {}) });
    }), concurrency);

    await pruneRemovedSources();
    vacancies.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    onEvent({ type: "done", matched: vacancies.length, added, errors });
    return { vacancies, errors };
  } finally {
    await browser.close();
  }
}
