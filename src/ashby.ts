import { sourcePublished } from "./dates.js";
import { fetchText, htmlToText } from "./structured-data.js";
import type { Source, Vacancy } from "./types.js";

/**
 * Ashby's public job posting API: one request per company board returns every
 * opening with its full description, workplace type and locations. Ashby has
 * no directory of boards; each company's slug comes from its careers link,
 * jobs.ashbyhq.com/<slug>. A role posted once per country becomes one vacancy
 * listing every location.
 */

interface AshbyJob {
  title?: string;
  jobUrl?: string;
  isListed?: boolean;
  publishedAt?: string;
  /** True for hybrid jobs as well; see `isRemote()`. */
  isRemote?: boolean | null;
  workplaceType?: string | null;
  location?: string;
  secondaryLocations?: Array<{ location?: string }>;
  department?: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  compensation?: { compensationTierSummary?: string | null };
}

/** The API URL of a board, by the slug in jobs.ashbyhq.com/<slug>. */
export function ashbyBoardUrl(slug: string): string {
  return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`;
}

function locationsOf(job: AshbyJob): string[] {
  return [job.location, ...(job.secondaryLocations ?? []).map((place) => place.location)]
    .map((place) => place?.trim())
    .filter((place): place is string => !!place);
}

/**
 * Ashby sets `isRemote` on hybrid jobs too; `workplaceType` (Remote, Hybrid,
 * OnSite) is the precise field, and `isRemote` only stands in when it is empty.
 */
function isRemote(job: AshbyJob): boolean {
  return job.workplaceType ? job.workplaceType === "Remote" : job.isRemote === true;
}

export async function scrapeAshby(source: Source): Promise<Vacancy[]> {
  const byTitle = new Map<string, { job: AshbyJob; locations: string[] }>();
  for (const boardUrl of [source.url, ...(source.extraUrls ?? [])]) {
    const { jobs } = JSON.parse(await fetchText(boardUrl)) as { jobs?: AshbyJob[] };
    for (const job of jobs ?? []) {
      const title = job.title?.trim();
      if (!title || !job.jobUrl || job.isListed === false) continue;
      const known = byTitle.get(title.toLowerCase());
      if (!known) {
        byTitle.set(title.toLowerCase(), { job, locations: locationsOf(job) });
        continue;
      }
      for (const place of locationsOf(job)) if (!known.locations.includes(place)) known.locations.push(place);
      // Keep the remote copy as the representative, so its format line is right.
      if (isRemote(job) && !isRemote(known.job)) known.job = job;
    }
  }
  return [...byTitle.values()].flatMap(({ job, locations }) => {
    const url = new URL(job.jobUrl!);
    if (!source.vacancyPathPatterns.some((pattern) => pattern.test(url.pathname))) return [];
    // "On-site" avoids the word "remote", which the profile matcher looks for.
    const format = isRemote(job) ? "Remote" : job.workplaceType === "Hybrid" ? "Hybrid" : job.workplaceType === "OnSite" ? "On-site" : undefined;
    const conditions = [format, locations.join("; "), job.compensation?.compensationTierSummary?.trim(), job.department?.trim()]
      .filter(Boolean)
      .join(" · ");
    const description = job.descriptionHtml ? htmlToText(job.descriptionHtml) : job.descriptionPlain?.trim() ?? "";
    return [{
      source: source.id,
      sourceName: source.name,
      title: job.title!.trim(),
      url: url.href,
      snippet: [conditions, description].filter(Boolean).join("\n\n").slice(0, 4_000),
      remoteByDefault: source.remoteByDefault,
      ...(job.workplaceType ? { remote: isRemote(job) } : {}),
      ...sourcePublished(job.publishedAt),
      fetchedAt: new Date().toISOString(),
    }];
  });
}
