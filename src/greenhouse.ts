import { decodeEntities, fetchText, htmlToText } from "./structured-data.js";
import type { Source, Vacancy } from "./types.js";

/**
 * Greenhouse's public Job Board API: one request per board returns every
 * opening with its full description. `url` and `extraUrls` are board API URLs.
 * Companies that hire in several countries often keep a board per country and
 * post the same role on each; such copies become one vacancy listing every
 * location.
 */

interface GreenhouseJob {
  title?: string;
  absolute_url?: string;
  content?: string;
  location?: { name?: string };
  departments?: Array<{ name?: string }>;
  metadata?: Array<{ value_type?: string; value?: { unit?: string; min_value?: string; max_value?: string } }> | null;
}

/** The API URL of a board, by the token in boards.greenhouse.io/<token>. */
export function greenhouseBoardUrl(token: string): string {
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`;
}

function salary(job: GreenhouseJob): string | undefined {
  const range = job.metadata?.find((field) => field.value_type === "currency_range")?.value;
  if (!range?.min_value && !range?.max_value) return undefined;
  const amount = (value?: string) => value ? Math.round(Number(value)).toLocaleString("en-US") : undefined;
  return `${range.unit ?? ""} ${[amount(range.min_value), amount(range.max_value)].filter(Boolean).join("–")}`.trim();
}

export async function scrapeGreenhouse(source: Source): Promise<Vacancy[]> {
  const byTitle = new Map<string, { job: GreenhouseJob; locations: string[] }>();
  for (const boardUrl of [source.url, ...(source.extraUrls ?? [])]) {
    const { jobs } = JSON.parse(await fetchText(boardUrl)) as { jobs?: GreenhouseJob[] };
    for (const job of jobs ?? []) {
      const title = job.title?.trim();
      if (!title || !job.absolute_url) continue;
      const location = job.location?.name?.trim();
      const known = byTitle.get(title.toLowerCase());
      if (known) {
        if (location && !known.locations.includes(location)) known.locations.push(location);
      } else {
        byTitle.set(title.toLowerCase(), { job, locations: location ? [location] : [] });
      }
    }
  }
  return [...byTitle.values()].flatMap(({ job, locations }) => {
    const url = new URL(job.absolute_url!);
    if (!source.vacancyPathPatterns.some((pattern) => pattern.test(url.pathname))) return [];
    const conditions = [locations.join("; "), salary(job), job.departments?.map((department) => department.name).filter(Boolean).join(", ")]
      .filter(Boolean)
      .join(" · ");
    // The API escapes the description HTML once more.
    const description = htmlToText(decodeEntities(job.content ?? ""));
    return [{
      source: source.id,
      sourceName: source.name,
      title: job.title!.trim(),
      url: url.href,
      snippet: [conditions, description].filter(Boolean).join("\n\n").slice(0, 4_000),
      remoteByDefault: source.remoteByDefault,
      // Greenhouse has no work-format field; a location named "… - Remote" is
      // the only structured signal, and its absence proves nothing.
      ...(locations.some((place) => /remote/i.test(place)) ? { remote: true } : {}),
      fetchedAt: new Date().toISOString(),
    }];
  });
}
