import { sourcePublished } from "./dates.js";
import { fetchText } from "./http.js";
import { htmlToText } from "./text.js";
import type { Source, Vacancy } from "./types.js";
import { isVacancyUrl, sourceVacancy } from "./vacancy.js";

/**
 * Himalayas, a remote-only job board, through its public search API: one
 * request per query returns up to 20 vacancies with full descriptions and the
 * countries applicants may work from. The queries are the profile's target
 * roles in English, so the source fits whoever runs Worklooker; `url` is the
 * board, used only when the profile has no English roles.
 * Almost every vacancy is limited to some countries, so the profile's
 * `workCountries` decides which of them fit.
 */

interface HimalayasJob {
  title?: string;
  companyName?: string;
  description?: string;
  excerpt?: string;
  locationRestrictions?: string[];
  seniority?: string[];
  minSalary?: number | null;
  maxSalary?: number | null;
  currency?: string | null;
  /** Unix seconds. */
  pubDate?: number;
  applicationLink?: string;
  guid?: string;
}

/** The search API URL for one query, such as a target role. */
export function himalayasSearchUrl(query: string): string {
  const url = new URL("https://himalayas.app/jobs/api/search");
  url.search = new URLSearchParams({ q: query, limit: "20" }).toString();
  return url.href;
}

/** The vacancy page, without the API's tracking parameter. */
function pageUrl(job: HimalayasJob): URL | undefined {
  const link = job.guid ?? job.applicationLink;
  if (!link) return undefined;
  const url = new URL(link);
  url.search = "";
  return url;
}

function conditions(job: HimalayasJob, countries: string[]): string {
  const salary = job.minSalary || job.maxSalary
    ? `${job.currency ?? ""} ${[job.minSalary, job.maxSalary].filter(Boolean).join("–")}`.trim()
    : undefined;
  return ["Remote", countries.length ? `Applicants from: ${countries.join(", ")}` : "Anywhere", salary].filter(Boolean).join(" · ");
}

/** Profile roles usable as English search queries: "head of frontend", not "техлид*". */
export function himalayasQueries(roles: string[]): string[] {
  const queries = roles
    .map((role) => role.replaceAll("*", "").trim().toLowerCase())
    .filter((role) => role && /^[a-z0-9 .+#/-]+$/.test(role));
  return [...new Set(queries)];
}

export async function scrapeHimalayas(source: Source, roles: string[]): Promise<Vacancy[]> {
  const byUrl = new Map<string, Vacancy>();
  const queries = himalayasQueries(roles);
  for (const searchUrl of queries.length ? queries.map(himalayasSearchUrl) : [himalayasSearchUrl("")]) {
    const { jobs } = JSON.parse(await fetchText(searchUrl)) as { jobs?: HimalayasJob[] };
    for (const job of jobs ?? []) {
      const url = pageUrl(job);
      const title = job.title?.trim();
      // Queries overlap: the same vacancy may come back from several of them.
      if (!url || !title || byUrl.has(url.href) || !isVacancyUrl(source, url)) continue;
      const countries = (job.locationRestrictions ?? []).map((country) => country.trim()).filter(Boolean);
      byUrl.set(url.href, sourceVacancy(source, {
        title,
        ...(job.companyName?.trim() ? { company: job.companyName.trim() } : {}),
        url: url.href,
        snippet: [conditions(job, countries), htmlToText(job.description ?? job.excerpt ?? "")].filter(Boolean).join("\n\n"),
        remote: true,
        allowedCountries: countries,
        ...sourcePublished(job.pubDate ? job.pubDate * 1_000 : undefined),
      }));
    }
  }
  return [...byUrl.values()];
}
