import { decodeEntities, fetchText, htmlToText } from "./structured-data.js";
import type { Source, Vacancy } from "./types.js";

/**
 * RSS 2.0 job feeds. Teamtailor career sites add `remoteStatus` and
 * `tt:locations` to each item; other feeds simply lack those lines.
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

/** One line of working conditions: format and countries. */
function conditions(item: string): string {
  const status = tagText(item, "remoteStatus");
  const countries = [...item.matchAll(/<tt:country>([\s\S]*?)<\/tt:country>/g)].map(([, country]) => decodeEntities(country).trim()).filter(Boolean);
  return [
    status ? remoteStatus[status] ?? status : undefined,
    countries.length ? [...new Set(countries)].join(", ") : undefined,
  ].filter(Boolean).join(" · ");
}

/** Teamtailor's status as a work format; absent on other feeds. */
function isRemote(item: string): boolean | undefined {
  const status = tagText(item, "remoteStatus");
  return status ? status === "fully" || status === "temporary" : undefined;
}

export async function scrapeRss(source: Source): Promise<Vacancy[]> {
  const xml = await fetchText(source.url);
  const seen = new Set<string>();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap(([, item]) => {
    const title = tagText(item, "title");
    const link = tagText(item, "link");
    if (!title || !link || seen.has(link)) return [];
    const url = new URL(link, source.url);
    if (!source.vacancyPathPatterns.some((pattern) => pattern.test(url.pathname))) return [];
    seen.add(link);
    const snippet = [conditions(item), htmlToText(tagText(item, "description") ?? "")].filter(Boolean).join("\n\n");
    return [{
      source: source.id,
      sourceName: source.name,
      title,
      url: url.href,
      snippet: snippet.slice(0, 4_000),
      remoteByDefault: source.remoteByDefault,
      ...(isRemote(item) === undefined ? {} : { remote: isRemote(item) }),
      fetchedAt: new Date().toISOString(),
    }];
  });
}
