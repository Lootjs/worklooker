import { sourcePublished } from "./dates.js";
import { fetchText } from "./http.js";
import { decodeEntities, htmlToText } from "./text.js";
import type { Source, Vacancy } from "./types.js";
import { isVacancyUrl, sourceVacancy } from "./vacancy.js";

/**
 * RSS 2.0 job feeds; `url` and `extraUrls` are feeds of the same source.
 * Teamtailor career sites add `remoteStatus` and `tt:locations` to each
 * item; We Work Remotely adds `region`; other feeds lack those lines.
 */

/** Text of the first `<tag>` in an item, without CDATA, with entities decoded. */
function tagText(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  if (!match) return undefined;
  const cdata = match[1].match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return cdata ? cdata[1] : decodeEntities(match[1]).trim();
}

// Teamtailor's remote statuses. "None" is written without the word "remote",
// so the matcher's remote check does not mistake it for a remote vacancy.
const remoteStatus: Record<string, string> = {
  fully: "Fully remote",
  temporary: "Temporarily remote",
  hybrid: "Hybrid",
  none: "On-site",
};

/** One line of working conditions: format and countries or region. */
function conditions(item: string): string {
  const status = tagText(item, "remoteStatus");
  const countries = [...item.matchAll(/<tt:country>([\s\S]*?)<\/tt:country>/g)].map(([, country]) => decodeEntities(country).trim()).filter(Boolean);
  const region = tagText(item, "region");
  return [
    status ? remoteStatus[status] ?? status : undefined,
    countries.length ? [...new Set(countries)].join(", ") : undefined,
    // "Anywhere in the World", "USA Only": read as-is by the remote and US checks.
    region ? `Region: ${region}` : undefined,
  ].filter(Boolean).join(" · ");
}

/** Teamtailor's status as a work format; absent on other feeds. */
function isRemote(item: string): boolean | undefined {
  const status = tagText(item, "remoteStatus");
  return status ? status === "fully" || status === "temporary" : undefined;
}

/** "Company: Role" titles, as We Work Remotely writes them, split in two. */
export function splitCompany(title: string): { title: string; company?: string } {
  const match = title.match(/^([^:]{2,80}):\s+(.+)$/);
  return match ? { company: match[1].trim(), title: match[2].trim() } : { title };
}

export async function scrapeRss(source: Source): Promise<Vacancy[]> {
  const seen = new Set<string>();
  const vacancies: Vacancy[] = [];
  for (const feedUrl of [source.url, ...(source.extraUrls ?? [])]) {
    const xml = await fetchText(feedUrl);
    for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const rawTitle = tagText(item, "title");
      const link = tagText(item, "link");
      // Feeds of one source overlap: a vacancy may sit in several categories.
      if (!rawTitle || !link || seen.has(link)) continue;
      const url = new URL(link, feedUrl);
      if (!isVacancyUrl(source, url)) continue;
      seen.add(link);
      const { title, company } = source.companyInTitle ? splitCompany(rawTitle) : { title: rawTitle, company: undefined };
      const snippet = [conditions(item), htmlToText(tagText(item, "description") ?? "")].filter(Boolean).join("\n\n");
      vacancies.push(sourceVacancy(source, {
        title,
        ...(company ? { company } : {}),
        url: url.href,
        snippet,
        ...(isRemote(item) === undefined ? {} : { remote: isRemote(item) }),
        ...sourcePublished(tagText(item, "pubDate")),
      }));
    }
  }
  return vacancies;
}
