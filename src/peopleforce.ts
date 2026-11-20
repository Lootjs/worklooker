import { sourcePublished } from "./dates.js";
import { fetchText, htmlToText } from "./structured-data.js";
import type { Source, Vacancy } from "./types.js";

/**
 * PeopleForce career sites answer `.json` next to their pages: `/careers.json`
 * lists the openings, and each vacancy's `.json` adds the full description.
 * Company career pages list few openings, so every description is fetched.
 */

interface ListedVacancy {
  id: number;
  title?: string;
  department?: { name?: string } | null;
  work_type?: string | null;
  location?: { name?: string } | null;
  vacancy_url?: string;
  created_at?: string;
}

interface VacancyDetails extends ListedVacancy {
  description_plain?: string;
  description_html?: string;
}

const detailPauseMs = 500;

/** The vacancy page without tracking parameters such as `?source=dou`. */
function pageUrl(vacancy: ListedVacancy, source: Source): URL {
  const url = new URL(vacancy.vacancy_url ?? `/careers/v/${vacancy.id}`, source.url);
  url.search = "";
  return url;
}

function conditions(vacancy: ListedVacancy): string {
  return [vacancy.location?.name, vacancy.work_type, vacancy.department?.name]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" · ");
}

export async function scrapePeopleForce(source: Source): Promise<Vacancy[]> {
  const listed = JSON.parse(await fetchText(new URL("/careers.json", source.url).href)) as ListedVacancy[];
  const vacancies: Vacancy[] = [];
  for (const [index, item] of listed.entries()) {
    const url = pageUrl(item, source);
    if (!item.title || !source.vacancyPathPatterns.some((pattern) => pattern.test(url.pathname))) continue;
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, detailPauseMs));
    let description = "";
    try {
      const details = JSON.parse(await fetchText(`${url.href}.json`)) as VacancyDetails;
      description = details.description_html ? htmlToText(details.description_html) : details.description_plain?.trim() ?? "";
    } catch {
      // Keep the vacancy with its title and conditions only.
    }
    vacancies.push({
      source: source.id,
      sourceName: source.name,
      title: item.title.trim(),
      url: url.href,
      snippet: [conditions(item), description].filter(Boolean).join("\n\n").slice(0, 4_000),
      remoteByDefault: source.remoteByDefault,
      // PeopleForce names a remote vacancy's location "Remote"; an office name proves nothing.
      ...(/remote/i.test(item.location?.name ?? "") ? { remote: true } : {}),
      ...sourcePublished(item.created_at),
      fetchedAt: new Date().toISOString(),
    });
  }
  return vacancies;
}
