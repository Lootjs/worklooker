import type { Vacancy } from "./types.js";

/**
 * The publication date a source gives, as vacancy fields. An absent or
 * unparseable value gives none: the store then dates the vacancy by when it
 * was first collected, and marks that it did.
 */
export function sourcePublished(value: string | number | null | undefined): Pick<Vacancy, "publishedAt" | "publishedAtSource"> {
  if (value === null || value === undefined || value === "") return {};
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? {} : { publishedAt: date.toISOString(), publishedAtSource: "source" };
}

/** Older than the profile allows; a vacancy without a date is never stale. */
export function isStale(publishedAt: string | undefined, maxAgeDays: number | undefined, now = new Date()): boolean {
  if (!publishedAt || maxAgeDays === undefined) return false;
  return now.getTime() - new Date(publishedAt).getTime() > maxAgeDays * 86_400_000;
}
