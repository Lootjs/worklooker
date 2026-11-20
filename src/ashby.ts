import { sourcePublished } from "./dates.js";
import { fetchText } from "./http.js";
import { htmlToText } from "./text.js";
import type { Source, Vacancy } from "./types.js";
import { isVacancyUrl, mergeByTitle, sourceVacancy } from "./vacancy.js";

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
  const jobs: AshbyJob[] = [];
  for (const boardUrl of [source.url, ...(source.extraUrls ?? [])]) {
    jobs.push(...(JSON.parse(await fetchText(boardUrl)) as { jobs?: AshbyJob[] }).jobs ?? []);
  }
  const listed = jobs.filter((job) => job.jobUrl && job.isListed !== false);
  // Keep the remote copy as the representative, so its format line is right.
  return mergeByTitle(listed, (job) => job.title, locationsOf, (candidate, current) => isRemote(candidate) && !isRemote(current)).flatMap(({ job, locations }) => {
    const url = new URL(job.jobUrl!);
    if (!isVacancyUrl(source, url)) return [];
    // "On-site" avoids the word "remote", which the profile matcher looks for.
    const format = isRemote(job) ? "Remote" : job.workplaceType === "Hybrid" ? "Hybrid" : job.workplaceType === "OnSite" ? "On-site" : undefined;
    const conditions = [format, locations.join("; "), job.compensation?.compensationTierSummary?.trim(), job.department?.trim()]
      .filter(Boolean)
      .join(" · ");
    const description = job.descriptionHtml ? htmlToText(job.descriptionHtml) : job.descriptionPlain?.trim() ?? "";
    return [sourceVacancy(source, {
      title: job.title!.trim(),
      url: url.href,
      snippet: [conditions, description].filter(Boolean).join("\n\n"),
      ...(job.workplaceType ? { remote: isRemote(job) } : {}),
      ...sourcePublished(job.publishedAt),
    })];
  });
}
