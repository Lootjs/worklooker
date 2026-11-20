import { sourcePublished } from "./dates.js";
import { fetchText } from "./http.js";
import { decodeEntities, htmlToText } from "./text.js";
import type { Source, Vacancy } from "./types.js";
import { isVacancyUrl, mergeByTitle, sourceVacancy } from "./vacancy.js";

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
  /** `updated_at` changes on any edit, so only this one is a publication date. */
  first_published?: string;
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
  const jobs: GreenhouseJob[] = [];
  for (const boardUrl of [source.url, ...(source.extraUrls ?? [])]) {
    jobs.push(...(JSON.parse(await fetchText(boardUrl)) as { jobs?: GreenhouseJob[] }).jobs ?? []);
  }
  const listed = jobs.filter((job) => job.absolute_url);
  return mergeByTitle(listed, (job) => job.title, (job) => job.location?.name?.trim() ? [job.location.name.trim()] : []).flatMap(({ job, locations }) => {
    const url = new URL(job.absolute_url!);
    if (!isVacancyUrl(source, url)) return [];
    const conditions = [locations.join("; "), salary(job), job.departments?.map((department) => department.name).filter(Boolean).join(", ")]
      .filter(Boolean)
      .join(" · ");
    // The API escapes the description HTML once more.
    const description = htmlToText(decodeEntities(job.content ?? ""));
    return [sourceVacancy(source, {
      title: job.title!.trim(),
      url: url.href,
      snippet: [conditions, description].filter(Boolean).join("\n\n"),
      // Greenhouse has no work-format field; a location named "… - Remote" is
      // the only structured signal, and its absence proves nothing.
      ...(locations.some((place) => /remote/i.test(place)) ? { remote: true } : {}),
      ...sourcePublished(job.first_published),
    })];
  });
}
