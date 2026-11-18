/** A stable slug controlled by this project's source registry. */
export type SourceId = string;

export interface Source {
  id: SourceId;
  name: string;
  url: string;
  /** Further listing pages or searches on the same source, collected after `url`. */
  extraUrls?: string[];
  /** Telegram previews only: how many history pages (~20 posts each) to read. */
  historyPages?: number;
  /** Wait for this selector when the listing is rendered after page load. */
  waitForSelector?: string;
  /** Structured listing cards; without it, every matching link is a candidate. */
  card?: {
    item: string;
    /** Link whose text is the vacancy title and whose href is the vacancy URL. */
    title: string;
    company?: string;
  };
  /**
   * The listing only has short metadata; the full description is on the
   * vacancy page under this selector. Fetched only for vacancies that already
   * pass the profile filter, then rated again with the full text.
   */
  detailDescription?: string;
  /** The supplied URLs already select remote vacancies where the source supports it. */
  remoteByDefault: boolean;
  /** Paths which identify a vacancy detail link on this particular source. */
  vacancyPathPatterns: RegExp[];
}

export interface Vacancy {
  source: SourceId;
  sourceName: string;
  title: string;
  /** Person or channel account that published the vacancy, when detectable. */
  author?: string;
  company?: string;
  url: string;
  snippet: string;
  remoteByDefault: boolean;
  fetchedAt: string;
}

export interface RatedVacancy extends Vacancy {
  score: number;
  reasons: string[];
}
