import { fetchText } from "./http.js";
import { decodeEntities, htmlToText } from "./text.js";
import { isVacancyUrl, sourceVacancy } from "./vacancy.js";
import type { Source, Vacancy } from "./types.js";

/**
 * Tilda Feeds: a Tilda site renders its job list in the browser from a public
 * feed API, behind a loader. Reading the feed directly returns every post with
 * its full text in one response, though the API itself is slow (~15 s).
 */

interface FeedPost {
  parts?: Array<{ title?: string }>;
  fields?: {
    title?: string;
    link?: { url?: string };
    url?: { url?: string };
    description?: string;
    // Custom fields: present only on feeds whose owner defined them.
    role?: string;
    location?: string;
    format?: string[] | string;
    income?: string;
    englevel?: string;
  };
}

interface Feed {
  result?: { posts?: FeedPost[] };
}

const feedTimeoutMs = 90_000;
// Closed vacancies stay in the feed under an "Archive" category.
const archivePart = /^(?:archive|архив)$/i;

/** The feed URL for a feed id, as the site's own script requests it. */
export function tildaFeedUrl(feedUid: string): string {
  const url = new URL("https://feeds.tildaapi.one/api/v2/getfeed/");
  url.search = new URLSearchParams({ feeduid: feedUid, size: "400", slice: "1" }).toString();
  return url.href;
}

function plain(value: string | undefined): string {
  return value ? decodeEntities(value).trim() : "";
}

/** Format, location, English level and pay on one line, as the site's card shows. */
function conditions(fields: NonNullable<FeedPost["fields"]>): string {
  return [
    [fields.format ?? []].flat().map(plain).filter(Boolean).join(" / "),
    plain(fields.location),
    fields.englevel ? `English: ${plain(fields.englevel)}` : "",
    plain(fields.income),
  ].filter(Boolean).join(" · ");
}

export async function scrapeTildaFeed(source: Source): Promise<Vacancy[]> {
  const feed = JSON.parse(await fetchText(source.url, feedTimeoutMs)) as Feed;
  const seen = new Set<string>();
  return (feed.result?.posts ?? []).flatMap(({ parts, fields }) => {
    if (!fields || parts?.some((part) => archivePart.test(plain(part.title)))) return [];
    const title = plain(fields.title);
    const link = fields.link?.url ?? fields.url?.url;
    if (!title || !link || seen.has(link)) return [];
    const url = new URL(link);
    if (!isVacancyUrl(source, url)) return [];
    seen.add(link);
    const formats = [fields.format ?? []].flat().map(plain).filter(Boolean);
    const snippet = [conditions(fields), htmlToText(fields.role ?? ""), htmlToText(fields.description ?? "")].filter(Boolean).join("\n\n");
    return [sourceVacancy(source, {
      title,
      url: url.href,
      snippet,
      // Formats list what is offered, e.g. "Remote / Relocation".
      ...(formats.length ? { remote: formats.some((format) => /remote/i.test(format)) } : {}),
    })];
  });
}
