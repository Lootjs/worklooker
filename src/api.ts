/**
 * Shapes the local API sends to the browser. The web app imports these as
 * types only, so it keeps no copies that could drift from the server.
 */
import type { SourceReport } from "./source-reports.js";

export type { CollectionError, CollectionEvent } from "./collect.js";
export type { SourceDropReason, SourceReport } from "./source-reports.js";
export type { SavedVacancy, VacancyStatus } from "./store.js";

/** One source in the sources view: its last collection and the user's decisions on it. */
export interface SourceSummary {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  report?: SourceReport;
  queued: number;
  liked: number;
  rejected: number;
}
