import { sourcePublished } from "./dates.js";
import { fetchText } from "./http.js";
import { htmlToText } from "./text.js";
import type { Source, Vacancy } from "./types.js";
import { sourceVacancy } from "./vacancy.js";

/**
 * Tribe (tribe.com.cy) renders its career page from its own public JSON API.
 * One page of the API holds full descriptions, work formats and countries, so
 * vacancy pages are never opened.
 */

interface Attribute {
  dictionary?: { name?: string };
}

interface TribeVacancy {
  id: number;
  position?: string;
  body?: string;
  requirements?: string;
  conditions?: string;
  work_formats?: Attribute[];
  work_locations?: Attribute[];
  grades?: Attribute[];
  functions?: Attribute[];
  /** When the vacancy was opened in Huntflow, the ATS behind the site. */
  created_at_huntflow?: string;
}

interface TribePage {
  data: TribeVacancy[];
  meta?: { current_page?: number; last_page?: number };
}

const api = "https://api.tribe.com.cy/api/vacancies";
const perPage = 100;
// Guards against a malformed `last_page`; the whole list is one page today.
const maxPages = 10;

function names(attributes: Attribute[] | undefined): string[] {
  return (attributes ?? []).map((attribute) => attribute.dictionary?.name?.trim()).filter((name): name is string => !!name);
}

/** Format, countries, grade and function on one line, as the site's card shows. */
function conditions(vacancy: TribeVacancy): string {
  return [names(vacancy.work_formats).join(" / "), names(vacancy.work_locations).join(", "), ...names(vacancy.grades), ...names(vacancy.functions)]
    .filter(Boolean)
    .join(" · ");
}

export async function scrapeTribe(source: Source): Promise<Vacancy[]> {
  const vacancies: Vacancy[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(api);
    url.search = new URLSearchParams({ page: String(page), per_page: String(perPage), locale: "en" }).toString();
    const { data, meta } = JSON.parse(await fetchText(url)) as TribePage;
    for (const vacancy of data) {
      if (!vacancy.position) continue;
      const sections: Array<[string, string | undefined]> = [["", vacancy.body], ["Requirements", vacancy.requirements], ["Conditions", vacancy.conditions]];
      const description = sections
        .map(([heading, html]) => html ? [heading, htmlToText(html)].filter(Boolean).join("\n") : "")
        .filter(Boolean)
        .join("\n\n");
      const formats = names(vacancy.work_formats);
      vacancies.push(sourceVacancy(source, {
        title: vacancy.position.trim(),
        url: new URL(`/jobs/${vacancy.id}`, source.url).href,
        snippet: [conditions(vacancy), description].filter(Boolean).join("\n\n"),
        // Several formats may be offered; remote among them is enough.
        ...(formats.length ? { remote: formats.some((format) => /remote/i.test(format)) } : {}),
        ...sourcePublished(vacancy.created_at_huntflow),
      }));
    }
    if (!data.length || (meta?.current_page ?? page) >= (meta?.last_page ?? page)) break;
  }
  return vacancies;
}
