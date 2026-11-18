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

function textFor(vacancy: Vacancy): string {
  return `${vacancy.title} ${vacancy.company ?? ""} ${vacancy.snippet}`.replace(/\s+/g, " ");
}

/**
 * Builds a rater for one profile. It scores conservatively: remote can be
 * mandatory, a target role is weighted heavily, and a senior role in the
 * user's field is kept for manual review.
 */
export function createMatcher(profile: MatchProfile): (vacancy: Vacancy) => RatedVacancy | undefined {
  const rolePattern = anyOf(profile.roles);
  const fieldPattern = anyOf(profile.field);
  const seniorPattern = anyOf(profile.seniority, false);
  const skillPatterns = profile.skills.filter((skill) => skill.trim()).map((skill) => ({ skill, pattern: anyOf([skill]) }));

  return (vacancy) => {
    const text = textFor(vacancy);
    const reasons: string[] = [];
    let score = 0;

    const isRemote = vacancy.remoteByDefault || remotePattern.test(text);
    if (profile.remoteOnly && !isRemote) return undefined;
    if (isRemote) {
      score += 4;
      reasons.push("удалённый формат");
    }

    const hasTargetRole = rolePattern.test(text);
    const isSeniorInField = seniorPattern.test(text) && fieldPattern.test(text);
    if (hasTargetRole) {
      score += 7;
      reasons.push("целевая роль");
    } else if (isSeniorInField) {
      score += 3;
      reasons.push("старшая роль в вашей области — на просмотр");
    }

    // Remote and language clues only describe working conditions. A vacancy
    // also needs a target role or a senior role in the user's field.
    if (!hasTargetRole && !isSeniorInField) return undefined;

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

    return score >= profile.minScore ? { ...vacancy, score, reasons } : undefined;
  };
}
