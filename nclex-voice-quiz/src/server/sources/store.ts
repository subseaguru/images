/**
 * Study sources: an index (`sources/index.json`) plus one text file per source. File names are
 * derived from the server-minted id only, never from user-supplied names.
 */
import { randomBytes } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { StudySource, StudySourceKind } from "../../shared/types.js";
import { ensureDirSync, JsonFile, writeAtomic } from "../storage/jsonFile.js";

interface SourcesIndex {
  version: 1;
  sources: StudySource[];
}

export interface NewSource {
  name: string;
  kind: StudySourceKind;
  text: string;
  url?: string;
}

export interface SourceWithText {
  source: StudySource;
  text: string;
}

export const PREVIEW_LENGTH = 200;
const ID_PATTERN = /^src-[a-z0-9]+-[a-z0-9]+$/;

export function mintSourceId(): string {
  return `src-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

export class SourceStore {
  private sources: StudySource[];
  private readonly file: JsonFile<SourcesIndex>;

  constructor(
    private readonly dir: string,
    warn: (message: string) => void = (m) => console.warn(m),
  ) {
    ensureDirSync(dir);
    this.file = new JsonFile<SourcesIndex>(path.join(dir, "index.json"), () => ({ version: 1, sources: [] }));
    let data: SourcesIndex;
    try {
      data = this.file.loadSync();
    } catch (err) {
      warn(`Could not read sources index (${(err as Error).message}); starting with no sources.`);
      data = { version: 1, sources: [] };
    }
    this.sources = Array.isArray(data.sources) ? data.sources.filter((s) => ID_PATTERN.test(s.id)) : [];
  }

  private textPath(id: string): string {
    if (!ID_PATTERN.test(id)) throw new Error(`Invalid source id: ${id}`);
    return path.join(this.dir, `${id}.txt`);
  }

  /** Newest first. */
  list(): StudySource[] {
    return [...this.sources].sort((a, b) => (a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : 0));
  }

  find(id: string): StudySource | undefined {
    return this.sources.find((s) => s.id === id);
  }

  async get(id: string): Promise<SourceWithText | undefined> {
    const source = this.find(id);
    if (!source) return undefined;
    let text = "";
    try {
      text = await readFile(this.textPath(id), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    return { source, text };
  }

  async add(input: NewSource): Promise<StudySource> {
    const text = input.text.trim();
    let id = mintSourceId();
    while (this.find(id)) id = mintSourceId();
    const source: StudySource = {
      id,
      name: input.name.trim() || "Untitled source",
      kind: input.kind,
      chars: text.length,
      addedAt: new Date().toISOString(),
      preview: text.slice(0, PREVIEW_LENGTH),
    };
    if (input.url) source.url = input.url;
    await writeAtomic(this.textPath(id), text);
    this.sources.push(source);
    await this.persist();
    return source;
  }

  async delete(id: string): Promise<boolean> {
    const index = this.sources.findIndex((s) => s.id === id);
    if (index < 0) return false;
    this.sources.splice(index, 1);
    await this.persist();
    await rm(this.textPath(id), { force: true });
    return true;
  }

  private persist(): Promise<void> {
    return this.file.save({ version: 1, sources: this.sources });
  }
}
