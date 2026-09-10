/**
 * Minimal typed JSON file store.
 *
 * Reads are synchronous so stores can be constructed without an async init step (this is a
 * single-user app with a handful of small files). Writes are atomic (temp file + rename) and
 * serialized per file through a promise chain, so two overlapping requests can never interleave
 * their bytes or race the rename.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

let tempCounter = 0;

export class JsonFile<T> {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    readonly filePath: string,
    private readonly makeDefault: () => T,
  ) {}

  /** Returns the parsed file, or the default when the file does not exist yet. */
  loadSync(): T {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return this.makeDefault();
      throw err;
    }
    if (raw.trim() === "") return this.makeDefault();
    return JSON.parse(raw) as T;
  }

  /** Serializes `value` now (so later mutations do not leak in) and writes it after pending writes. */
  save(value: T): Promise<void> {
    const json = JSON.stringify(value, null, 2) + "\n";
    const run = () => writeAtomic(this.filePath, json);
    const next = this.queue.then(run, run);
    // Keep the chain alive even when a write fails; the failure is still reported to this caller.
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Resolves once every write queued so far has finished (used by tests and shutdown). */
  flush(): Promise<void> {
    return this.queue;
  }
}

export function ensureDirSync(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export async function writeAtomic(filePath: string, contents: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  tempCounter += 1;
  const tmp = `${filePath}.${process.pid}.${tempCounter}.tmp`;
  try {
    await writeFile(tmp, contents);
    await rename(tmp, filePath);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}
