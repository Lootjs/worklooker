import { mkdir, open, rm, stat } from "node:fs/promises";
import { join } from "node:path";

/** Where decisions and reports live; tests point it at a temporary folder. */
export const dataDirectory = process.env.WORKLOOKER_DATA_DIR ?? "data";

export function dataPath(name: string): string {
  return join(dataDirectory, name);
}

/** A lock older than this belongs to a process that died while holding it. */
const staleLockMs = 60_000;
const retryMs = 100;
const giveUpMs = 30_000;

/**
 * Runs `task` while holding `<name>.lock` in the data folder. The server and a
 * scheduled `pnpm collect` may write the same file at once; each write is a
 * read-modify-write, so without the lock one would drop the other's changes.
 */
export async function withFileLock<T>(name: string, task: () => Promise<T>): Promise<T> {
  await mkdir(dataDirectory, { recursive: true });
  const lockPath = dataPath(`${name}.lock`);
  const started = Date.now();
  for (;;) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.close();
      break;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const age = await stat(lockPath).then((info) => Date.now() - info.mtimeMs, () => 0);
      if (age > staleLockMs) await rm(lockPath, { force: true });
      else if (Date.now() - started > giveUpMs) throw new Error(`${lockPath} занят другим процессом дольше ${giveUpMs / 1000} с`);
      else await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }
  try {
    return await task();
  } finally {
    await rm(lockPath, { force: true });
  }
}

/**
 * Chains tasks within this process, then takes the file lock for each, so a
 * reader never sees a half-written file and writers never interleave.
 */
export function serializedWith(name: string): <T>(task: () => Promise<T>) => Promise<T> {
  let queue: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>) => {
    const run = queue.then(() => withFileLock(name, task));
    queue = run.catch(() => undefined);
    return run;
  };
}
