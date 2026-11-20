import { readLocalConfig } from "./local-config.js";
import { ashbyBoardUrl } from "./ashby.js";
import { greenhouseBoardUrl } from "./greenhouse.js";
import { tildaFeedUrl } from "./tilda.js";
import type { Source } from "./types.js";

function telegramSource(id: string, name: string, handle: string, remoteByDefault = false): Source {
  return {
    id,
    name,
    // The /s/ preview is public and exposes individual message links for collection.
    url: `https://t.me/s/${handle}`,
    remoteByDefault,
    keepsClosedPosts: true,
    // Telegram's preview page uses /s/channel, while its message permalink is
    // /channel/message-id. Keep the permalink, not an arbitrary outbound link.
    vacancyPathPatterns: [new RegExp(`^/(?:s/)?${handle}/\\d+$`)],
  };
}

/**
 * A Built In job search, read from the JSON-LD in its server-rendered pages.
 * `search` is the path and query after builtin.com, as in the browser's address
 * bar. Pages hold 25 vacancies (10 for a company filter); reading stops at the
 * first empty page, so `pages` is only an upper bound.
 */
function builtInSource(id: string, name: string, search: string, pages = 10): Source {
  const url = new URL(search, "https://builtin.com");
  const page = (number: number) => {
    const pageUrl = new URL(url);
    pageUrl.searchParams.set("page", String(number));
    return pageUrl.href;
  };
  return {
    id,
    name,
    url: url.href,
    extraUrls: Array.from({ length: pages - 1 }, (_, index) => page(index + 2)),
    format: "json-ld",
    remoteByDefault: true,
    vacancyPathPatterns: [/^\/job\/[^/]+\/\d+$/],
  };
}

/**
 * A Teamtailor career site, read from its RSS feed: one request returns every
 * opening with its full description, remote status and location.
 */
function teamtailorSource(id: string, name: string, origin: string): Source {
  return {
    id,
    name,
    url: new URL("/jobs.rss", origin).href,
    format: "rss",
    remoteByDefault: false,
    vacancyPathPatterns: [/^\/jobs\/\d+-/],
  };
}

/** A PeopleForce career site, read from its `.json` pages; `origin` is the company's subdomain. */
function peopleforceSource(id: string, name: string, origin: string): Source {
  return {
    id,
    name,
    url: new URL("/careers", origin).href,
    format: "peopleforce",
    remoteByDefault: false,
    vacancyPathPatterns: [/^\/careers\/v\/\d+-/],
  };
}

/**
 * A company's vacancies on Habr Career; `company` is the alias in
 * career.habr.com/companies/<alias>. Recruiting agencies often publish here
 * rather than on their own sites.
 */
function habrCareerSource(id: string, name: string, company: string): Source {
  const listing = `https://career.habr.com/companies/${company}/vacancies`;
  return {
    id,
    name,
    url: listing,
    // A company page holds 25 cards; further pages are empty for most companies.
    extraUrls: [2, 3].map((page) => `${listing}?page=${page}`),
    card: { item: ".vacancy-card", title: "a.vacancy-card__title-link", company: ".vacancy-card__company" },
    detailDescription: ".vacancy-description__text",
    remoteByDefault: false,
    vacancyPathPatterns: [/^\/vacancies\/\d+$/],
  };
}

/**
 * A company's Greenhouse job boards, by their tokens (boards.greenhouse.io/<token>,
 * or "board":{"token":…} in a careers page that embeds them). Read through
 * Greenhouse's public Job Board API.
 */
function greenhouseSource(id: string, name: string, boards: string[], vacancyPath: RegExp): Source {
  const [first, ...rest] = boards.map(greenhouseBoardUrl);
  return { id, name, url: first, extraUrls: rest, format: "greenhouse", remoteByDefault: false, vacancyPathPatterns: [vacancyPath] };
}

/** A company's Ashby job board, by the slug in jobs.ashbyhq.com/<slug>. */
function ashbySource(id: string, name: string, slug: string): Source {
  return {
    id,
    name,
    url: ashbyBoardUrl(slug),
    format: "ashby",
    remoteByDefault: false,
    vacancyPathPatterns: [new RegExp(`^/${slug}/[0-9a-f-]{36}$`, "i")],
  };
}

export const sources: Source[] = [
  {
    id: "getmatch",
    name: "Getmatch",
    // The SEO path pre-filters to remote Lead / Manager roles; the generic
    // first page is mostly unrelated specialities.
    url: "https://getmatch.ru/vacancies/remote/lead",
    remoteByDefault: true,
    vacancyPathPatterns: [/^\/vacancies\/\d+-/],
  },
  {
    id: "geekjob",
    name: "GeekJob",
    url: "https://geekjob.ru/vacancies",
    // The newest feed pages plus searches, because the feed is mostly unrelated roles.
    extraUrls: [
      ...[2, 3, 4, 5].map((page) => `https://geekjob.ru/vacancies/${page}`),
      ...["frontend", "фронтенд", "vue"].map((query) => `https://geekjob.ru/vacancies?qs=${encodeURIComponent(query)}`),
    ],
    card: { item: "#serplist li.collection-item", title: ".vacancy-name a", company: ".company-name a" },
    detailDescription: "#vacancy-description",
    remoteByDefault: false,
    vacancyPathPatterns: [/^\/vacancy\/[0-9a-f]{24}$/],
  },
  {
    id: "wantapply",
    name: "Wantapply",
    url: "https://wantapply.com/?workplaceTypes=remote",
    remoteByDefault: true,
    vacancyPathPatterns: [/^\/(vacancies|jobs?)\//],
  },
  {
    id: "remocate",
    name: "Remocate",
    url: "https://www.remocate.app/?workType=remote",
    remoteByDefault: true,
    vacancyPathPatterns: [/^\/jobs\//],
  },
  telegramSource("dev-connectablejobs", "Dev Connectable Jobs", "dev_connectablejobs"),
  telegramSource("jobfortm", "Job for IT-TOP", "jobfortm"),
  telegramSource("young-relocate", "Relocate", "young_relocate"),
  telegramSource("opento-dev", "Dev Jobs", "opento_dev"),
  telegramSource("remote-jobs-relocate", "Remote Jobs Relocate", "remote_jobs_relocate"),
  {
    id: "tabby",
    name: "Tabby careers",
    url: "https://tabby.ai/en-AE/careers#careers",
    // Openings are injected from Pinpoint after the page has loaded.
    waitForSelector: 'a[href*="pinpointhq.com/"][href*="/jobs/"]',
    remoteByDefault: false,
    vacancyPathPatterns: [/^\/(?:[a-z]{2}\/)?jobs\/\d+$/],
  },
  {
    id: "uzum",
    name: "Uzum careers",
    url: "https://people.uzum.com/career/ru/vacancies",
    remoteByDefault: false,
    vacancyPathPatterns: [/^\/career\/ru\/vacancies\//, /\/vacanc/],
  },
  {
    id: "emex",
    name: "EMEX careers",
    url: "https://emex.huntflow.io/",
    remoteByDefault: false,
    vacancyPathPatterns: [/\/vacanc/, /\/jobs?\//],
  },
  {
    id: "plata",
    name: "Plata careers",
    // One page lists every opening; the cards are rendered after page load.
    url: "https://plata.careers/vacancy",
    waitForSelector: 'a[href*="/vacancy/details?id="]',
    // Each card is the link; its metadata line says "Remote Work" for remote roles.
    card: { item: 'a[href*="/vacancy/details?id="]', title: "h3" },
    detailDescription: ".content",
    remoteByDefault: false,
    vacancyPathPatterns: [/^\/vacancy\/details$/],
  },
  builtInSource("snoonu", "Snoonu", "/jobs/remote?companyId=198996&allLocations=true"),
  // Built In searches: remote front-end roles, and engineering managers, whom
  // the front-end category misses. The profile filter decides the rest.
  builtInSource("builtin-frontend", "Built In: Front End", "/jobs/remote/dev-engineering/front-end"),
  builtInSource("builtin-engineering-manager", "Built In: Engineering Manager", "/jobs/remote/dev-engineering?search=engineering%20manager&allLocations=true"),
  teamtailorSource("made-of-storm", "Made of Storm", "https://talent.madeofstormcareers.com"),
  {
    id: "tribe",
    name: "Tribe",
    url: "https://tribe.com.cy/jobs",
    format: "tribe",
    remoteByDefault: false,
    vacancyPathPatterns: [/^\/jobs\/\d+$/],
  },
  {
    id: "lucky-hunter",
    name: "Lucky Hunter",
    // The site shows a loader while its script fetches this Tilda feed; read
    // the feed directly. Its id is in the getfeed request on /jobs.
    url: tildaFeedUrl("768227718941"),
    format: "tilda-feed",
    remoteByDefault: false,
    vacancyPathPatterns: [/^\/jobs\/[\w-]+$/],
  },
  peopleforceSource("altegio", "Altegio", "https://altegio.peopleforce.io"),
  // Employ City has an empty vacancies section on its own site and posts on Habr Career.
  habrCareerSource("employ-city", "Employ City", "employcity"),
  {
    id: "wisebits",
    name: "Wisebits",
    // The home page lists bare titles; each vacancy page has a JobPosting.
    url: "https://wisebits.com/",
    format: "json-ld",
    remoteByDefault: false,
    vacancyPathPatterns: [/^\/vacancies\/\d+-/],
  },
  // One board per hiring country; the same role repeats on most of them.
  greenhouseSource(
    "fundraise-up",
    "Fundraise Up",
    ["usa", "uk", "armenia", "cyprus", "georgia", "poland", "portugal", "serbia", "spain", "turkey"].map((country) => `fundraiseup-${country}`),
    /^\/careers\/\d+\/?$/,
  ),
  ashbySource("clickhouse", "ClickHouse", "clickhouse"),
  // Ashby boards picked for remote engineering roles open to Europe or worldwide.
  ashbySource("n8n", "n8n", "n8n"),
  ashbySource("linear", "Linear", "linear"),
  ashbySource("elevenlabs", "ElevenLabs", "elevenlabs"),
  ashbySource("railway", "Railway", "railway"),
  ashbySource("deepnote", "Deepnote", "deepnote"),
  // Curated from the supplied catalogue: broad enough for leadership roles,
  // while the profile matcher still rejects non-remote and junior posts.
  telegramSource("it-vakansii-udalenka", "IT & Digital — Remote and Office", "it_vakansii_udalenka"),
  telegramSource("remocate-channel", "Remocate channel", "evacuatejobs", true),
  telegramSource("lenkep", "IT Work: Serbia and Remote", "youritjob", true),
  telegramSource("remote-jobs", "Remote Jobs", "remotejobss", true),
  telegramSource("jobgeeks", "Top IT Jobs", "jobGeeks"),
  telegramSource("digital-club-jobs", "Digital Club Jobs", "digitalclubjobs"),
  telegramSource("zarubezhom-jobs", "Работа за рубежом", "zarubezhom_jobs"),
  telegramSource("geekjobs", "GeekJobs", "geekjobs"),
  {
    // One feed per category; regions such as "Anywhere in the World" come with each item.
    id: "weworkremotely",
    name: "We Work Remotely",
    url: "https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss",
    extraUrls: ["remote-front-end-programming-jobs", "remote-management-and-finance-jobs"].map((category) => `https://weworkremotely.com/categories/${category}.rss`),
    format: "rss",
    companyInTitle: true,
    remoteByDefault: true,
    vacancyPathPatterns: [/^\/remote-jobs\/[\w-]+$/],
  },
  {
    // Searched by the profile's English target roles; each vacancy lists the countries it accepts.
    id: "himalayas",
    name: "Himalayas",
    url: "https://himalayas.app/jobs",
    format: "himalayas",
    remoteByDefault: true,
    vacancyPathPatterns: [/^\/companies\/[\w-]+\/jobs\/[\w-]+$/],
  },
  {
    // Listings carry titles only; matching titles get their vacancy page read for the rest.
    id: "hirehi",
    name: "HireHi",
    url: "https://hirehi.ru/vacancies/cto",
    extraUrls: ["https://hirehi.ru/vacancies/frontend", "https://hirehi.ru/head-jobs", "https://hirehi.ru/lead-jobs", "https://hirehi.ru/remote-jobs"],
    format: "json-ld",
    remoteByDefault: false,
    vacancyPathPatterns: [/^\/[a-z-]+\/[\w-]+-\d+$/],
  },
];

/** Sources to collect now: all configured ones minus those disabled locally. */
export function enabledSources(): Source[] {
  const disabled = new Set(readLocalConfig().disabledSources ?? []);
  return sources.filter((source) => !disabled.has(source.id));
}

export function isSourceEnabled(id: string): boolean {
  return !(readLocalConfig().disabledSources ?? []).includes(id);
}

/** A public Telegram channel, read from its web preview at t.me/s/<channel>. */
export function isTelegramChannel(source: Source): boolean {
  const url = new URL(source.url);
  return url.hostname === "t.me" && url.pathname.startsWith("/s/");
}

/** A private chat with a bot needs a local MTProto user session, not web scraping. */
export const wantApplyBotSource: Source = {
  id: "wantapply-bot",
  name: "WantApply bot",
  url: "https://t.me/wantapply_bot",
  remoteByDefault: false,
  keepsClosedPosts: true,
  vacancyPathPatterns: [],
};

/** Every source Worklooker knows, including the private bot chat. */
export const allSources: Source[] = [...sources, wantApplyBotSource];

/** Ids of known sources the user has not switched off; their undecided cards stay queued. */
export function activeSourceIds(): Set<string> {
  const disabled = new Set(readLocalConfig().disabledSources ?? []);
  return new Set(allSources.filter((source) => !disabled.has(source.id)).map((source) => source.id));
}
