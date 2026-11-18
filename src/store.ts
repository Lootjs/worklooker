import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sources, wantApplyBotSource } from "./sources.js";
import type { RatedVacancy } from "./types.js";

export type VacancyStatus = "new" | "liked" | "rejected";

export interface SavedVacancy extends RatedVacancy {
  id: string;
  status: VacancyStatus;
  decidedAt?: string;
}

const dataDirectory = "data";
const statePath = join(dataDirectory, "vacancies.json");
const rejectedPath = join(dataDirectory, "rejected.json");
const telegramSourceIds = new Set(sources.filter((source) => new URL(source.url).hostname === "t.me").map((source) => source.id));
const digestPattern = /(?:^|\s)#(?:дайджест|digest)(?=\s|$)|(?:^|\n)\s*(?:подборка\s+вакансий|дайджест\s+вакансий|вакансии\s+за)/im;

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, " ").trim();
}

export function vacancyId(vacancy: Pick<RatedVacancy, "title" | "company" | "source">): string {
  // Company is preferred when a source provides it; source is a stable fallback.
  return Buffer.from(`${normalize(vacancy.title)}|${normalize(vacancy.company ?? vacancy.source)}`).toString("base64url");
}

async function readStoredVacancies(): Promise<SavedVacancy[]> {
  try {
    return JSON.parse(await readFile(statePath, "utf8")) as SavedVacancy[];
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function saveVacancies(vacancies: SavedVacancy[]): Promise<void> {
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(statePath, JSON.stringify(vacancies, null, 2));
  await writeFile(rejectedPath, JSON.stringify(vacancies.filter((vacancy) => vacancy.status === "rejected"), null, 2));
}

const knownSourceIds = new Set([...sources, wantApplyBotSource].map((source) => source.id));

// Every write is a read-modify-write of the whole file. Collection now saves
// each source as it finishes, while the user keeps deciding on cards, so all
// mutations go through one queue to avoid losing each other's changes.
let writeQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task);
  writeQueue = run.catch(() => undefined);
  return run;
}

function withoutNoise(vacancies: SavedVacancy[]): SavedVacancy[] {
  return vacancies.filter((vacancy) => {
    const isDigest = digestPattern.test(`${vacancy.title}\n${vacancy.snippet}`);
    let isLegacyTelegramOutboundLink = false;
    // Previous collector versions saved arbitrary outbound links embedded in
    // Telegram posts. New records use a permalink to the post itself.
    try { isLegacyTelegramOutboundLink = telegramSourceIds.has(vacancy.source) && new URL(vacancy.url).hostname !== "t.me"; }
    catch { isLegacyTelegramOutboundLink = true; }
    // Rejected entries remain in the archive, but noisy current and liked
    // records are removed from the working queue.
    return vacancy.status === "rejected" || (!isDigest && !isLegacyTelegramOutboundLink);
  });
}

/** Queued behind pending writes, so a reader never sees a half-written file. */
export function readVacancies(): Promise<SavedVacancy[]> {
  return serialized(readStoredVacancies);
}

export interface SourceMergeResult {
  /** Vacancies which were not stored before this merge. */
  added: number;
}

/**
 * Replaces one source's undecided vacancies with its latest results. Other
 * sources are untouched, so a failed source keeps its earlier queue. Existing
 * records keep their position and new ones are appended, so the card the user
 * is looking at does not jump while collection is still running.
 */
export function mergeSourceVacancies(sourceId: string, incoming: RatedVacancy[]): Promise<SourceMergeResult> {
  return serialized(async () => {
    const existing = withoutNoise(await readStoredVacancies());
    const incomingById = new Map<string, RatedVacancy>();
    for (const vacancy of incoming) if (!incomingById.has(vacancyId(vacancy))) incomingById.set(vacancyId(vacancy), vacancy);

    const merged: SavedVacancy[] = [];
    for (const vacancy of existing) {
      const fresh = incomingById.get(vacancy.id);
      if (fresh) {
        merged.push({ ...fresh, id: vacancy.id, status: vacancy.status, decidedAt: vacancy.decidedAt });
        incomingById.delete(vacancy.id);
      } else if (vacancy.source !== sourceId || vacancy.status !== "new") {
        // Keep decisions for jobs that have disappeared temporarily from the source.
        merged.push(vacancy);
      }
    }
    for (const [id, vacancy] of incomingById) merged.push({ ...vacancy, id, status: "new" });
    await saveVacancies(merged);
    return { added: incomingById.size };
  });
}

/** Drops undecided vacancies from sources that are no longer configured. */
export function pruneRemovedSources(): Promise<void> {
  return serialized(async () => {
    const vacancies = await readStoredVacancies();
    const kept = vacancies.filter((vacancy) => vacancy.status !== "new" || knownSourceIds.has(vacancy.source));
    if (kept.length !== vacancies.length) await saveVacancies(kept);
  });
}

export function setVacancyStatus(id: string, status: VacancyStatus): Promise<SavedVacancy | undefined> {
  return serialized(async () => {
    const vacancies = await readStoredVacancies();
    const vacancy = vacancies.find((item) => item.id === id);
    if (!vacancy) return undefined;
    vacancy.status = status;
    vacancy.decidedAt = status === "new" ? undefined : new Date().toISOString();
    await saveVacancies(vacancies);
    return vacancy;
  });
}
