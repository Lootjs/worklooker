/**
 * Text helpers shared by the scrapers, the matcher and the store. Vacancy text
 * is mixed Russian and English: JavaScript's `\b` sees only ASCII word
 * characters, so word edges are written as Unicode lookarounds.
 */

export const wordStart = String.raw`(?<![\p{L}\p{N}_])`;
export const wordEnd = String.raw`(?![\p{L}\p{N}_])`;

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Matches a phrase whatever whitespace, including line breaks, separates its words. */
export function phrasePattern(phrase: string, flags = ""): RegExp {
  return new RegExp(phrase.trim().split(/\s+/).map(escapeRegExp).join(String.raw`\s+`), flags);
}

/** Collapses spaces inside lines but keeps line breaks, at most one blank line in a row. */
export function tidyLines(text: string): string {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A digest bundles several jobs into one post. Kept as one vacancy, its
 * title, score and link would all be misleading.
 */
export const digestPattern = new RegExp(
  `${wordStart}#(?:дайджест|digest)${wordEnd}|^\\s*(?:подборка\\s+вакансий|дайджест\\s+вакансий|вакансии\\s+за)${wordEnd}`,
  "imu",
);

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

/** Decodes named and numeric character references. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (match, code: string) => {
    if (code[0] !== "#") return entities[code.toLowerCase()] ?? match;
    const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(point) ? String.fromCodePoint(point) : match;
  });
}

/** Vacancy descriptions are HTML: keep paragraphs and list items as lines. */
export function htmlToText(html: string): string {
  return tidyLines(decodeEntities(html
    // Each item starts its own line, so its closing tag, or a paragraph that
    // ends it, must not add another one.
    .replace(/(?:<\/p>\s*)?<\/li>/gi, "")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<(?:br|\/p|\/ul|\/ol|\/h\d|\/div)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")));
}
