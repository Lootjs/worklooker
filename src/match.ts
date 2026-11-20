import type { MatchProfile } from "./local-config.js";
import { escapeRegExp, wordEnd, wordStart } from "./text.js";
import type { RatedVacancy, Vacancy } from "./types.js";

const never = /(?!)/;
const word = (body: string, closed = true): RegExp => new RegExp(`${wordStart}(?:${body})${closed ? wordEnd : ""}`, "iu");

/** "руководител* frontend" → any whitespace between words, `*` continues a word. */
function phraseSource(phrase: string): string {
  return phrase.trim().split(/\s+/).map((part) => part.endsWith("*")
    ? `${escapeRegExp(part.slice(0, -1))}[\\p{L}\\p{N}-]*`
    : escapeRegExp(part)).join(String.raw`\s+`);
}

function anyOf(phrases: string[], closed = true): RegExp {
  const usable = phrases.filter((phrase) => phrase.trim());
  // An empty alternation would match everything; an empty list matches nothing.
  return usable.length ? word(usable.map(phraseSource).join("|"), closed) : never;
}

// Working conditions are the same for every profile.
const remotePattern = word(String.raw`remote|distributed|work\s+from\s+home|удал[её]н|дистанцион`, false);
const russianPattern = new RegExp(`${word(String.raw`russian|русск(?:ий|оязыч[а-яё]*)|russia|снг|cis`).source}|[а-яё]{4,}`, "iu");

// Signs that a vacancy needs someone working from Russia, or is offered by a
// Russian employer. Salary in roubles is not one: companies abroad pay in
// roubles too.
const russia = String.raw`(?:рф|росси[а-яё]*)`;
const russiaPattern = word([
  String.raw`удал[её]нн?[а-яё]*(?:\s+работ[а-яё]*)?\s+(?:по|из|в)\s+${russia}`,
  String.raw`на\s+территории\s+${russia}`,
  String.raw`(?:резидент|граждан)[а-яё]*\s+${russia}`,
  String.raw`тк\s+рф|трудов[а-яё]*\s+кодекс[а-яё]*\s+${russia}`,
  String.raw`(?:самозанят[а-яё]*|ип)\s+(?:в\s+)?${russia}`,
  String.raw`только\s+(?:из|в|по)\s+${russia}`,
  String.raw`(?:проживающ|находящ)[а-яё]*\s+в\s+${russia}`,
  String.raw`аккредитованн[а-яё]*\s+(?:it|ит|айти)`,
  String.raw`дмс`,
  String.raw`бел[а-яё]*\s+(?:зарплат[а-яё]*|з\s*/\s*п|зп)`,
  String.raw`официальн[а-яё]*\s+трудоустройств[а-яё]*`,
  String.raw`офис[а-яё]*\s+в\s+(?:москв[а-яё]*|санкт-петербург[а-яё]*|петербург[а-яё]*|питер[а-яё]*|спб)`,
  String.raw`сколково`,
  String.raw`госуслуг[а-яё]*`,
].join("|"));
// A Russian legal form. Case-sensitive, so an exclamation "Ооо!" is not one.
const russianCompanyPattern = /(?<![\p{L}\p{N}_])ООО(?![\p{L}\p{N}_])/u;
// Large Russian employers whose postings carry none of the signs above. Read
// from the title and the company only: a description may well say "like at
// Yandex". Extend the list as new ones turn up.
const russianEmployerPattern = word([
  String.raw`магнит[а-яё]*`,
  String.raw`мтс(?:\s+банк)?|mts`,
  String.raw`сбер[а-яё]*|sber[a-z]*`,
  String.raw`яндекс[а-яё]*|yandex`,
  String.raw`т-банк[а-яё]*|t-bank|тинькофф|tinkoff`,
  String.raw`вконтакте|vk(?:\s+tech)?|вк`,
  String.raw`ozon|озон[а-яё]*`,
  String.raw`wildberries|вайлдберриз`,
  String.raw`авито|avito`,
  String.raw`лаборатори[а-яё]*\s+касперского|kaspersky`,
].join("|"));

// Signs that a vacancy needs someone working from the United States. Unlike
// Russia, an American employer alone is not one: many hire worldwide. A bare
// "us" counts only in fixed phrases, so "join us remotely" does not match.
const usaName = String.raw`(?:u\.s\.(?:a\.)?|usa|united\s+states(?:\s+of\s+america)?|сша)`;
const usa = String.raw`(?:us|${usaName})`;
const usaPattern = word([
  String.raw`${usa}[\s-]*only`,
  // "US-based" alone may describe clients or the company; only the candidate counts.
  String.raw`(?:must\s+be|you(?:'re|’re|\s+are)|candidates?\s+(?:must|should)\s+be)\s+${usa}[\s-]*based`,
  String.raw`${usa}[\s-]*based\s+(?:candidates?|applicants?|only|remote)`,
  String.raw`remote\s*[-–—,(:/|]\s*${usa}`,
  String.raw`${usaName}\s*[-–—,(:/|]?\s*remote`,
  String.raw`applicants\s+from:?\s*${usa}`,
  String.raw`(?:based|located|residing|reside|living|live)\s+(?:in|within)\s+(?:the\s+)?${usa}`,
  String.raw`(?:authori[sz]ed|authori[sz]ation|eligible|eligibility|right)\s+to\s+work\s+in\s+(?:the\s+)?${usa}`,
  String.raw`${usa}\s+(?:citizens?(?:hip)?|persons?|residents?|work\s+authori[sz]ation)`,
  String.raw`green\s+card|security\s+clearance`,
  String.raw`(?:только|удал[её]нн?[а-яё]*)\s+(?:из|в|по)\s+сша`,
  String.raw`(?:резидент|граждан)[а-яё]*\s+сша`,
].join("|"));

function textFor(vacancy: Vacancy): string {
  return `${vacancy.title} ${vacancy.company ?? ""} ${vacancy.snippet}`.replace(/\s+/g, " ");
}

/** Why a vacancy did not enter the queue; the first rule that failed. */
export type DropReason = "excludedRole" | "notRemote" | "notTargetRole" | "russia" | "usa" | "country" | "blocker" | "lowScore";

/** Same country, whatever the case or extra spaces: "United  States" is "united states". */
function countryKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Whether a title could pass the profile at all: it names a target role or
 * the field, and no excluded role. Lets a collector skip opening vacancy
 * pages whose listing gives only a title.
 */
export function createTitleCheck(profile: MatchProfile): (title: string) => boolean {
  const rolePattern = anyOf(profile.roles);
  const fieldPattern = anyOf(profile.field);
  const excludedRolePattern = anyOf(profile.excludeRoles ?? []);
  return (title) => {
    const flat = title.replace(/\s+/g, " ");
    return !excludedRolePattern.test(flat) && (rolePattern.test(flat) || fieldPattern.test(flat));
  };
}

export type MatchVerdict =
  | { vacancy: RatedVacancy }
  /** `detail` is the text that triggered an exclusion, for review. */
  | { dropped: DropReason; detail?: string };

/**
 * Builds a rater for one profile. It scores conservatively: remote can be
 * mandatory, a target role is weighted heavily, and a senior role in the
 * user's field is kept for manual review.
 *
 * The role decides what a vacancy is, so target roles, excluded roles and the
 * field are read from the title only: a description mentions other roles too
 * ("you will report to our Head of Engineering", "our app is built with
 * TypeScript"). Seniority, skills, remote wording, language, blockers and
 * Russian signs come from the whole text, since titles often omit them.
 */
export function createRater(profile: MatchProfile): (vacancy: Vacancy) => MatchVerdict {
  const rolePattern = anyOf(profile.roles);
  const fieldPattern = anyOf(profile.field);
  const seniorPattern = anyOf(profile.seniority, false);
  const excludedRolePattern = anyOf(profile.excludeRoles ?? []);
  const blockerPattern = anyOf(profile.blockers ?? []);
  const workCountries = new Set((profile.workCountries ?? []).map(countryKey));
  const skillPatterns = profile.skills.filter((skill) => skill.trim()).map((skill) => ({ skill, pattern: anyOf([skill]) }));

  return (vacancy) => {
    const text = textFor(vacancy);
    const title = vacancy.title.replace(/\s+/g, " ");
    const reasons: string[] = [];
    let score = 0;

    const excludedRole = title.match(excludedRolePattern);
    if (excludedRole) return { dropped: "excludedRole", detail: excludedRole[0] };

    // A structured work format beats wording: a hybrid job's description may
    // still say "remote-friendly".
    const isRemote = vacancy.remote ?? (vacancy.remoteByDefault || remotePattern.test(text));
    if (profile.remoteOnly && !isRemote) return { dropped: "notRemote" };
    if (isRemote) {
      score += 4;
      reasons.push("удалённый формат");
    }

    const hasTargetRole = rolePattern.test(title);
    const isSeniorInField = fieldPattern.test(title) && seniorPattern.test(text);
    if (hasTargetRole) {
      score += 7;
      reasons.push("целевая роль");
    } else if (isSeniorInField) {
      score += 3;
      reasons.push("старшая роль в вашей области — на просмотр");
    }

    // Remote and language clues only describe working conditions. A vacancy
    // also needs a target role or a senior role in the user's field.
    if (!hasTargetRole && !isSeniorInField) return { dropped: "notTargetRole" };

    // A source's own list of countries applicants may work from: the user's
    // country must be on it. An empty or absent list means anywhere.
    const allowed = vacancy.allowedCountries ?? [];
    if (workCountries.size && allowed.length && !allowed.some((country) => workCountries.has(countryKey(country)))) {
      return { dropped: "country", detail: allowed.slice(0, 3).join(", ") + (allowed.length > 3 ? "…" : "") };
    }

    if (profile.excludeRussia) {
      const sign = text.match(russiaPattern) ?? text.match(russianCompanyPattern)
        ?? `${title} ${vacancy.company ?? ""}`.match(russianEmployerPattern);
      if (sign) return { dropped: "russia", detail: sign[0] };
    }
    if (profile.excludeUSA) {
      const sign = text.match(usaPattern);
      if (sign) return { dropped: "usa", detail: sign[0] };
    }
    const blocker = text.match(blockerPattern);
    if (blocker) return { dropped: "blocker", detail: blocker[0] };

    const matchedSkills = skillPatterns.filter(({ pattern }) => pattern.test(text)).map(({ skill }) => skill);
    if (matchedSkills.length) {
      score += Math.min(matchedSkills.length, 4);
      reasons.push(`стек: ${matchedSkills.join(", ")}`);
    }
    if (seniorPattern.test(text)) {
      score += 1;
      reasons.push("опытный уровень");
    }
    if (profile.preferRussian && russianPattern.test(text)) {
      score += 2;
      reasons.push("есть признак русскоязычной среды");
    }

    return score >= profile.minScore ? { vacancy: { ...vacancy, score, reasons } } : { dropped: "lowScore" };
  };
}

/** The rated vacancy, or `undefined` when it does not enter the queue. */
export function createMatcher(profile: MatchProfile): (vacancy: Vacancy) => RatedVacancy | undefined {
  const rate = createRater(profile);
  return (vacancy) => {
    const verdict = rate(vacancy);
    return "vacancy" in verdict ? verdict.vacancy : undefined;
  };
}
