/** A stable slug controlled by this project's source registry. */
export type SourceId = string;

export interface Source {
  id: SourceId;
  name: string;
  url: string;
  /** Further listing pages or searches on the same source, collected after `url`. */
  extraUrls?: string[];
  /** Wait for this selector when the listing is rendered after page load. */
  waitForSelector?: string;
  /** Structured listing cards; without it, every matching link is a candidate. */
  card?: {
    item: string;
    /**
     * Link whose text is the vacancy title and whose href is the vacancy URL.
     * When the card itself is a link, this is just the title element inside it.
     */
    title: string;
    company?: string;
  };
  /**
   * The listing only has short metadata; the full description is on the
   * vacancy page under this selector. Fetched only for vacancies that already
   * pass the profile filter, then rated again with the full text.
   */
  detailDescription?: string;
  /**
   * How to read the source; without it the listing is rendered in a browser.
   * - `json-ld`: listings and vacancy pages carry schema.org JSON-LD
   *   (`ItemList`, `JobPosting`), read over plain HTTP. Listing pages stop at
   *   the first empty one.
   * - `rss`: `url` is an RSS feed whose items hold the full description.
   * - `tribe`: Tribe's own public JSON API (see `src/tribe.ts`).
   * - `tilda-feed`: `url` is a Tilda Feeds API URL (see `src/tilda.ts`).
   * - `peopleforce`: a PeopleForce career site's `.json` pages (see `src/peopleforce.ts`).
   * - `greenhouse`: `url` and `extraUrls` are Greenhouse Job Board API URLs (see `src/greenhouse.ts`).
   * - `ashby`: `url` is an Ashby job posting API URL (see `src/ashby.ts`).
   * All of them ignore `card` and `detailDescription`.
   */
  format?: "json-ld" | "rss" | "tribe" | "tilda-feed" | "peopleforce" | "greenhouse" | "ashby";
  /** The supplied URLs already select remote vacancies where the source supports it. */
  remoteByDefault: boolean;
  /**
   * A feed of posts, such as a Telegram channel: posts stay after the vacancy
   * closes, so vacancies older than the profile's `maxAgeDays` are dropped.
   * Career boards list only open vacancies and keep long-open ones.
   */
  keepsClosedPosts?: boolean;
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
  /**
   * Work format from the source's structured data: true for remote, false for
   * hybrid or on-site. Absent when the source does not say, and then the
   * matcher looks for remote wording in the text.
   */
  remote?: boolean;
  /** When the last collection saw it. */
  fetchedAt: string;
  /**
   * When it was published: from the source when it says (`"source"`),
   * otherwise when Worklooker first collected it (`"collector"`).
   */
  publishedAt?: string;
  publishedAtSource?: "source" | "collector";
}

export interface RatedVacancy extends Vacancy {
  score: number;
  reasons: string[];
}
