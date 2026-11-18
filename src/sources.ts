import { readLocalConfig } from "./local-config.js";
import type { Source } from "./types.js";

function telegramSource(id: string, name: string, handle: string, remoteByDefault = false): Source {
  return {
    id,
    name,
    // The /s/ preview is public and exposes individual message links for collection.
    url: `https://t.me/s/${handle}`,
    remoteByDefault,
    // Telegram's preview page uses /s/channel, while its message permalink is
    // /channel/message-id. Keep the permalink, not an arbitrary outbound link.
    vacancyPathPatterns: [new RegExp(`^/(?:s/)?${handle}/\\d+$`)],
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
  // Curated from the supplied catalogue: broad enough for leadership roles,
  // while the profile matcher still rejects non-remote and junior posts.
  telegramSource("it-vakansii-udalenka", "IT & Digital — Remote and Office", "it_vakansii_udalenka"),
  telegramSource("remocate-channel", "Remocate channel", "evacuatejobs", true),
  telegramSource("lenkep", "IT Work: Serbia and Remote", "youritjob", true),
  telegramSource("remote-jobs", "Remote Jobs", "remotejobss", true),
  telegramSource("jobgeeks", "Top IT Jobs", "jobGeeks"),
  telegramSource("digital-club-jobs", "Digital Club Jobs", "digitalclubjobs"),
];

/** Sources to collect now: all configured ones minus those disabled locally. */
export function enabledSources(): Source[] {
  const disabled = new Set(readLocalConfig().disabledSources ?? []);
  return sources.filter((source) => !disabled.has(source.id));
}

/** A private chat with a bot needs a local MTProto user session, not web scraping. */
export const wantApplyBotSource: Source = {
  id: "wantapply-bot",
  name: "WantApply bot",
  url: "https://t.me/wantapply_bot",
  remoteByDefault: false,
  vacancyPathPatterns: [],
};
