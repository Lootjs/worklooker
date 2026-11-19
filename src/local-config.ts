import { readFileSync } from "node:fs";

/**
 * Who the vacancies are for. Phrases are case-insensitive; words may be
 * separated by any whitespace, and a trailing `*` lets a word continue, for
 * Russian endings: `руководител*` matches «руководитель», «руководителя».
 */
export interface MatchProfile {
  /** Target roles. Any of them in a vacancy's title is the strongest signal. */
  roles: string[];
  /**
   * Your field: a title in it ("Frontend Developer") at a senior level is kept
   * for manual review even without a target role.
   */
  field: string[];
  /** Seniority words; they also match as prefixes, e.g. `lead` matches «leadership». */
  seniority: string[];
  /** Skills shown as reasons and added to the score. */
  skills: string[];
  /** Drop every vacancy that is not remote: by the source's work format, or remote wording when it has none. */
  remoteOnly: boolean;
  /** Rank vacancies with a Russian-speaking environment higher. */
  preferRussian: boolean;
  /** Minimum score to enter the queue; 6 keeps remote senior roles in your field. */
  minScore: number;
}

/** Machine-specific settings, kept out of Git. */
export interface LocalConfig {
  profile?: MatchProfile;
  /** Source ids from src/sources.ts which should not be collected. */
  disabledSources?: string[];
}

export const localConfigPath = "worklooker.local.json";
/** Committed template; also the fallback profile until a local one exists. */
export const exampleConfigPath = "worklooker.example.json";

function readJson(path: string): LocalConfig | undefined {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    return JSON.parse(contents) as LocalConfig;
  } catch (error: unknown) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Read on every collection, so edits apply without restarting the server. */
export function readLocalConfig(): LocalConfig {
  return readJson(localConfigPath) ?? {};
}

function checkProfile(profile: MatchProfile, path: string): MatchProfile {
  const lists = ["roles", "field", "seniority", "skills"] as const;
  for (const key of lists) {
    if (!Array.isArray(profile[key]) || profile[key].some((item) => typeof item !== "string")) {
      throw new Error(`${path}: profile.${key} должен быть списком строк`);
    }
  }
  if (typeof profile.remoteOnly !== "boolean" || typeof profile.preferRussian !== "boolean") {
    throw new Error(`${path}: profile.remoteOnly и profile.preferRussian должны быть true или false`);
  }
  if (typeof profile.minScore !== "number") throw new Error(`${path}: profile.minScore должен быть числом`);
  return profile;
}

/** The local profile, or the example one while the user has not made their own. */
export function readProfile(): { profile: MatchProfile; isExample: boolean } {
  const local = readLocalConfig().profile;
  if (local) return { profile: checkProfile(local, localConfigPath), isExample: false };
  const example = readJson(exampleConfigPath)?.profile;
  if (!example) throw new Error(`Нет профиля: создайте ${localConfigPath} по образцу ${exampleConfigPath}`);
  return { profile: checkProfile(example, exampleConfigPath), isExample: true };
}
