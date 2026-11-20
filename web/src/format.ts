import type { SavedVacancy } from "../../src/api";

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

/** Short and relative where it helps: "сегодня, 15:59", "вчера, 09:10", "18 нояб., 15:59". */
export function formatWhen(value: string, now = new Date()): string {
  const date = new Date(value);
  const time = new Intl.DateTimeFormat("ru-RU", { timeStyle: "short" }).format(date);
  const day = (moment: Date) => new Date(moment.getFullYear(), moment.getMonth(), moment.getDate()).getTime();
  const daysAgo = Math.round((day(now) - day(date)) / 86_400_000);
  if (daysAgo === 0) return `сегодня, ${time}`;
  if (daysAgo === 1) return `вчера, ${time}`;
  const sameYear = date.getFullYear() === now.getFullYear();
  return `${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).format(date)}, ${time}`;
}

/** Russian noun form for a count: 1 лайк, 3 лайка, 5 лайков. */
export function plural(count: number, one: string, few: string, many: string): string {
  const lastTwo = count % 100;
  const last = count % 10;
  return lastTwo >= 11 && lastTwo <= 14 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many;
}

export function percent(share: number): string {
  return new Intl.NumberFormat("ru-RU", { style: "percent", maximumFractionDigits: share > 0 && share < 0.1 ? 1 : 0 }).format(share);
}

/** "опубликована 3 дня назад" when the source dates it, "найдена …" when only Worklooker does. */
export function ageLabel(vacancy: Pick<SavedVacancy, "publishedAt" | "publishedAtSource">): string | undefined {
  if (!vacancy.publishedAt) return undefined;
  const verb = vacancy.publishedAtSource === "source" ? "опубликована" : "найдена";
  const days = Math.floor((Date.now() - new Date(vacancy.publishedAt).getTime()) / 86_400_000);
  if (days <= 0) return `${verb} сегодня`;
  if (days === 1) return `${verb} вчера`;
  return `${verb} ${days} ${plural(days, "день", "дня", "дней")} назад`;
}
