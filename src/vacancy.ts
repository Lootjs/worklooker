import type { Source, Vacancy } from "./types.js";

/** Longest description kept per vacancy; enough to rate it and show the card. */
export const maxSnippetLength = 4_000;

/** Whether a link is a vacancy page of this source, not a menu or listing link. */
export function isVacancyUrl(source: Source, url: string | URL): boolean {
  const { pathname } = typeof url === "string" ? new URL(url) : url;
  return source.vacancyPathPatterns.some((pattern) => pattern.test(pathname));
}

type VacancyFields = Omit<Vacancy, "source" | "sourceName" | "remoteByDefault" | "fetchedAt">;

/** A vacancy read from `source` now: fills in where it came from and trims the description. */
export function sourceVacancy(source: Source, fields: VacancyFields): Vacancy {
  return {
    source: source.id,
    sourceName: source.name,
    remoteByDefault: source.remoteByDefault,
    fetchedAt: new Date().toISOString(),
    ...fields,
    snippet: fields.snippet.slice(0, maxSnippetLength),
  };
}

/**
 * Companies that hire in several countries post one role per country, or keep
 * a board per country. Copies with the same title become one entry listing
 * every location; `prefer` picks which copy represents them.
 */
export function mergeByTitle<T>(
  jobs: T[],
  title: (job: T) => string | undefined,
  locations: (job: T) => string[],
  prefer: (candidate: T, current: T) => boolean = () => false,
): Array<{ job: T; locations: string[] }> {
  const byTitle = new Map<string, { job: T; locations: string[] }>();
  for (const job of jobs) {
    const key = title(job)?.trim().toLowerCase();
    if (!key) continue;
    const known = byTitle.get(key);
    if (!known) {
      byTitle.set(key, { job, locations: [...new Set(locations(job))] });
      continue;
    }
    for (const place of locations(job)) if (!known.locations.includes(place)) known.locations.push(place);
    if (prefer(job, known.job)) known.job = job;
  }
  return [...byTitle.values()];
}
