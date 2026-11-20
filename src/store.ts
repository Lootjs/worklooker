import { writeFile, readFile } from "node:fs/promises";
import { isStale } from "./dates.js";
import { dataPath, serializedWith } from "./data-files.js";
import { allSources, isTelegramChannel } from "./sources.js";
import { digestPattern } from "./text.js";
import type { RatedVacancy } from "./types.js";

export type VacancyStatus = "new" | "liked" | "rejected";

export interface SavedVacancy extends RatedVacancy {
  id: string;
  status: VacancyStatus;
  decidedAt?: string;
}

const statePath = dataPath("vacancies.json");
const rejectedPath = dataPath("rejected.json");
const telegramChannelIds = new Set(allSources.filter(isTelegramChannel).map((source) => source.id));
const feedSourceIds = new Set(allSources.filter((source) => source.keepsClosedPosts).map((source) => source.id));

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// Legal forms say nothing about which company it is: "Acme Inc." is "Acme".
const legalForms = new Set(["inc", "incorporated", "ltd", "limited", "llc", "gmbh", "corp", "corporation", "plc", "ооо", "оао", "зао", "пао", "ао", "тоо"]);
function normalizeCompany(value: string): string {
  return normalize(value).split(" ").filter((word) => !legalForms.has(word)).join(" ");
}

/**
 * A vacancy's identity: its normalized role and company. Without a company,
 * the source stands in for it, so unrelated posts with the same role in two
 * channels stay apart.
 */
export function vacancyId(vacancy: Pick<RatedVacancy, "title" | "company" | "source">): string {
  const owner = vacancy.company ? normalizeCompany(vacancy.company) : "";
  return Buffer.from(`${normalize(vacancy.title)}|${owner || normalize(vacancy.source)}`).toString("base64url");
}

/**
 * A role without a company, long enough to be specific: the same post copied
 * into another channel. Short titles ("Frontend Developer") are too common to
 * treat as one vacancy.
 */
function crossPostKey(vacancy: Pick<RatedVacancy, "title" | "company">): string | undefined {
  if (vacancy.company) return undefined;
  const title = normalize(vacancy.title);
  return title.length >= 30 ? title : undefined;
}

/**
 * The publication date to keep when a vacancy is collected again: the
 * source's own date wins; otherwise the stored one stays, so a collector date
 * remains the first time the vacancy was seen.
 */
function publication(fresh: RatedVacancy, stored?: SavedVacancy): Pick<SavedVacancy, "publishedAt" | "publishedAtSource"> {
  if (fresh.publishedAt && fresh.publishedAtSource === "source") return { publishedAt: fresh.publishedAt, publishedAtSource: "source" };
  if (stored?.publishedAt) return { publishedAt: stored.publishedAt, publishedAtSource: stored.publishedAtSource ?? "collector" };
  return { publishedAt: fresh.fetchedAt, publishedAtSource: "collector" };
}

// A like wins: a duplicate is often rejected only to clear it from the queue
// after its other copy was saved, and losing a saved job costs more than
// seeing one twice.
const statusWeight: Record<VacancyStatus, number> = { new: 0, rejected: 1, liked: 2 };

/**
 * Brings records written by earlier versions up to date: dates them, and
 * recomputes identities. Two records that turn out to be one vacancy keep the
 * user's decision (a like over a rejection over nothing).
 */
function upgraded(vacancies: SavedVacancy[]): SavedVacancy[] {
  const byId = new Map<string, SavedVacancy>();
  for (const stored of vacancies) {
    const vacancy = { ...stored, ...(stored.publishedAt ? {} : publication(stored)), id: vacancyId(stored) };
    const known = byId.get(vacancy.id);
    if (!known || statusWeight[vacancy.status] > statusWeight[known.status]) byId.set(vacancy.id, vacancy);
  }
  return [...byId.values()];
}

async function readStoredVacancies(): Promise<SavedVacancy[]> {
  try {
    return upgraded(JSON.parse(await readFile(statePath, "utf8")) as SavedVacancy[]);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function saveVacancies(vacancies: SavedVacancy[]): Promise<void> {
  await writeFile(statePath, JSON.stringify(vacancies, null, 2));
  await writeFile(rejectedPath, JSON.stringify(vacancies.filter((vacancy) => vacancy.status === "rejected"), null, 2));
}

const serialized = serializedWith("vacancies");

/**
 * Undecided records that should not be in the queue: digests, which bundle
 * several jobs, and Telegram records from earlier versions that saved a
 * post's outbound link instead of the post. Liked and rejected records are
 * the user's decisions and always stay.
 */
function isNoise(vacancy: SavedVacancy): boolean {
  if (vacancy.status !== "new") return false;
  if (digestPattern.test(`${vacancy.title}\n${vacancy.snippet}`)) return true;
  try {
    return telegramChannelIds.has(vacancy.source) && new URL(vacancy.url).hostname !== "t.me";
  } catch {
    return true;
  }
}

/** Queued behind pending writes, so a reader never sees a half-written file. */
export function readVacancies(): Promise<SavedVacancy[]> {
  return serialized(readStoredVacancies);
}

/**
 * A queued post from a feed that keeps closed vacancies, older than the
 * profile allows. Collection drops such posts when the source dates them; this
 * also covers posts dated by when Worklooker first saw them.
 */
export function isExpiredPost(vacancy: SavedVacancy, maxAgeDays: number | undefined, now = new Date()): boolean {
  return vacancy.status === "new" && feedSourceIds.has(vacancy.source) && isStale(vacancy.publishedAt, maxAgeDays, now);
}

export interface SourceMergeResult {
  /** Vacancies which were not stored before this merge. */
  added: number;
}

/**
 * Replaces one source's undecided vacancies with its latest results. Other
 * sources are untouched, so a failed source keeps its earlier queue. Existing
 * records keep their position and new ones are appended, so the card the user
 * is looking at does not jump while collection is still running. A post
 * already stored from another channel is not added again.
 */
export function mergeSourceVacancies(sourceId: string, incoming: RatedVacancy[]): Promise<SourceMergeResult> {
  return serialized(async () => {
    const existing = (await readStoredVacancies()).filter((vacancy) => !isNoise(vacancy));
    const incomingById = new Map<string, RatedVacancy>();
    for (const vacancy of incoming) if (!incomingById.has(vacancyId(vacancy))) incomingById.set(vacancyId(vacancy), vacancy);

    const merged: SavedVacancy[] = [];
    for (const vacancy of existing) {
      const fresh = incomingById.get(vacancy.id);
      if (fresh) {
        merged.push({ ...fresh, ...publication(fresh, vacancy), id: vacancy.id, status: vacancy.status, decidedAt: vacancy.decidedAt });
        incomingById.delete(vacancy.id);
      } else if (vacancy.source !== sourceId || vacancy.status !== "new") {
        // Keep decisions for jobs that have disappeared temporarily from the source.
        merged.push(vacancy);
      }
    }
    const crossPosts = new Set(existing.filter((vacancy) => vacancy.source !== sourceId).map(crossPostKey).filter(Boolean));
    let added = 0;
    for (const [id, vacancy] of incomingById) {
      const key = crossPostKey(vacancy);
      if (key && crossPosts.has(key)) continue;
      merged.push({ ...vacancy, ...publication(vacancy), id, status: "new" });
      added += 1;
    }
    await saveVacancies(merged);
    return { added };
  });
}

/** Drops undecided vacancies from sources that are gone or switched off. */
export function pruneInactiveSources(activeSourceIds: Set<string>): Promise<void> {
  return serialized(async () => {
    const vacancies = await readStoredVacancies();
    const kept = vacancies.filter((vacancy) => vacancy.status !== "new" || activeSourceIds.has(vacancy.source));
    await saveVacancies(kept);
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
