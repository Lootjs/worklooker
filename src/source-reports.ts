import { readFile, writeFile } from "node:fs/promises";
import { dataPath, serializedWith } from "./data-files.js";
import type { DropReason, MatchVerdict } from "./match.js";
import type { Vacancy } from "./types.js";

/** Why a collected vacancy did not reach the queue: a profile rule, or its age. */
export type SourceDropReason = DropReason | "stale";

export interface DroppedExample {
  title: string;
  url: string;
  /** The text that triggered an exclusion, such as "ТК РФ". */
  detail?: string;
}

/** What the last collection of one source found and what it filtered out. */
export interface SourceReport {
  sourceId: string;
  collectedAt: string;
  /** Vacancies read from the source. */
  found: number;
  /** Vacancies that passed the profile. */
  matched: number;
  /** Vacancies not stored before. */
  added: number;
  error?: string;
  dropped: Partial<Record<SourceDropReason, { count: number; examples: DroppedExample[] }>>;
}

const reportsPath = dataPath("sources.json");
/** Enough titles to spot a wrong filter without making the file heavy. */
const examplesPerReason = 20;

/**
 * Counts one source's verdicts. A source may rate a vacancy twice (listing
 * summary, then full description), so the last verdict per vacancy counts.
 * Vacancies are told apart by link and title: a bot's messages may share one link.
 */
export class SourceTally {
  private readonly verdicts = new Map<string, { vacancy: Vacancy; reason?: SourceDropReason; detail?: string }>();

  record(vacancy: Vacancy, verdict: MatchVerdict | { dropped: "stale"; detail?: string }): void {
    this.verdicts.set(`${vacancy.url}\n${vacancy.title}`, "dropped" in verdict
      ? { vacancy, reason: verdict.dropped, detail: verdict.detail }
      : { vacancy });
  }

  /** Vacancies read from the source so far. */
  get found(): number {
    return this.verdicts.size;
  }

  report(sourceId: string, added: number, error?: string): SourceReport {
    const dropped: SourceReport["dropped"] = {};
    let matched = 0;
    for (const { vacancy, reason, detail } of this.verdicts.values()) {
      if (!reason) {
        matched += 1;
        continue;
      }
      const group = dropped[reason] ??= { count: 0, examples: [] };
      group.count += 1;
      if (group.examples.length < examplesPerReason) group.examples.push({ title: vacancy.title.slice(0, 160), url: vacancy.url, ...(detail ? { detail } : {}) });
    }
    return { sourceId, collectedAt: new Date().toISOString(), found: this.found, matched, added, ...(error ? { error } : {}), dropped };
  }
}

async function readReports(): Promise<Record<string, SourceReport>> {
  try {
    return JSON.parse(await readFile(reportsPath, "utf8")) as Record<string, SourceReport>;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

const serialized = serializedWith("sources");

export function readSourceReports(): Promise<Record<string, SourceReport>> {
  return serialized(readReports);
}

/** Replaces the source's previous report: only the last collection is kept. */
export function saveSourceReport(report: SourceReport): Promise<void> {
  return serialized(async () => {
    const reports = await readReports();
    reports[report.sourceId] = report;
    await writeFile(reportsPath, JSON.stringify(reports, null, 2));
  });
}
