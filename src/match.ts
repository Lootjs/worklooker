import type { MatchProfile } from "./local-config.js";
import type { RatedVacancy, Vacancy } from "./types.js";

// JavaScript's `\b` only understands ASCII word characters, so it never matches
// around Cyrillic words. These Unicode-aware boundaries work for both scripts.
const start = String.raw`(?<![\p{L}\p{N}_])`;
const end = String.raw`(?![\p{L}\p{N}_])`;
const never = /(?!)/;
const word = (body: string, closed = true): RegExp => new RegExp(`${start}(?:${body})${closed ? end : ""}`, "iu");

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

function textFor(vacancy: Vacancy): string {
  return `${vacancy.title} ${vacancy.company ?? ""} ${vacancy.snippet}`.replace(/\s+/g, " ");
}

/** Why a vacancy did not enter the queue; the first rule that failed. */
export type DropReason = "excludedRole" | "notRemote" | "notTargetRole" | "russia" | "blocker" | "lowScore";

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

    if (profile.excludeRussia) {
      const sign = text.match(russiaPattern) ?? text.match(russianCompanyPattern);
      if (sign) return { dropped: "russia", detail: sign[0] };
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
