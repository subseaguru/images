/**
 * The question bank: read-only seed files plus the learner's own generated/imported questions
 * (persisted to `questions.json`). Ids are unique across both halves.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type {
  CategoryId,
  Difficulty,
  Question,
  QuestionFile,
  QuestionSource,
} from "../../shared/types.js";
import { CATEGORY_IDS, QUESTION_SOURCES } from "../../shared/types.js";
import { JsonFile } from "../storage/jsonFile.js";
import { validateQuestion } from "./validate.js";

export interface QuestionFilter {
  categories?: readonly CategoryId[];
  sources?: readonly QuestionSource[];
  difficulty?: readonly Difficulty[];
  /** Case-insensitive substring match on stem and option text. */
  q?: string;
}

export interface QuestionCounts {
  total: number;
  bySource: Record<QuestionSource, number>;
  byCategory: Record<CategoryId, number>;
}

export type DeleteResult = "deleted" | "missing" | "bundled";

const ID_PREFIX: Record<QuestionSource, string> = { bundled: "q", ai: "ai", imported: "imp" };

function isQuestionFile(value: unknown): value is { questions: unknown[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { questions?: unknown }).questions)
  );
}

export class QuestionStore {
  private readonly seeded = new Map<string, Question>();
  private readonly own = new Map<string, Question>();
  private readonly file: JsonFile<QuestionFile>;
  private mintCounter = 0;

  constructor(options: { seedDir: string; dataFile: string; warn?: (message: string) => void }) {
    const warn = options.warn ?? ((message: string) => console.warn(message));
    this.loadSeeds(options.seedDir, warn);
    this.file = new JsonFile<QuestionFile>(options.dataFile, () => ({ version: 1, questions: [] }));
    this.loadOwn(warn);
  }

  private loadSeeds(seedDir: string, warn: (message: string) => void): void {
    let names: string[];
    try {
      names = readdirSync(seedDir).filter((name) => name.endsWith(".json")).sort();
    } catch (err) {
      warn(`Seed directory ${seedDir} could not be read (${(err as Error).message}); starting with no bundled questions.`);
      return;
    }
    for (const name of names) {
      const file = path.join(seedDir, name);
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(file, "utf8"));
      } catch (err) {
        warn(`Skipping seed file ${name}: ${(err as Error).message}`);
        continue;
      }
      if (!isQuestionFile(parsed)) {
        warn(`Skipping seed file ${name}: expected { version: 1, questions: [...] }`);
        continue;
      }
      parsed.questions.forEach((raw, index) => {
        const result = validateQuestion(raw, { defaultSource: "bundled" });
        if (!result.ok) {
          warn(`Skipping ${name}[${index}]: ${result.errors.join("; ")}`);
          return;
        }
        // Everything in the seed directory is the bundled bank, whatever the file claims.
        const question = { ...result.question, source: "bundled" as const };
        if (!question.id || this.seeded.has(question.id)) {
          warn(`Skipping ${name}[${index}]: ${question.id ? `duplicate id ${question.id}` : "missing id"}`);
          return;
        }
        this.seeded.set(question.id, question);
      });
    }
  }

  private loadOwn(warn: (message: string) => void): void {
    let data: QuestionFile;
    try {
      data = this.file.loadSync();
    } catch (err) {
      warn(`Could not read ${this.file.filePath} (${(err as Error).message}); starting with an empty bank.`);
      return;
    }
    if (!isQuestionFile(data)) {
      warn(`${this.file.filePath} is not a question file; ignoring it.`);
      return;
    }
    data.questions.forEach((raw, index) => {
      const result = validateQuestion(raw, { defaultSource: "imported" });
      if (!result.ok) {
        warn(`Skipping questions.json[${index}]: ${result.errors.join("; ")}`);
        return;
      }
      const question = result.question;
      if (!question.id || this.has(question.id)) {
        warn(`Skipping questions.json[${index}]: ${question.id ? `duplicate id ${question.id}` : "missing id"}`);
        return;
      }
      this.own.set(question.id, question);
    });
  }

  all(): Question[] {
    return [...this.seeded.values(), ...this.own.values()];
  }

  get(id: string): Question | undefined {
    return this.seeded.get(id) ?? this.own.get(id);
  }

  has(id: string): boolean {
    return this.seeded.has(id) || this.own.has(id);
  }

  size(): number {
    return this.seeded.size + this.own.size;
  }

  stems(): string[] {
    return this.all().map((q) => q.stem);
  }

  list(filter: QuestionFilter = {}): Question[] {
    const categories = filter.categories && filter.categories.length > 0 ? new Set(filter.categories) : null;
    const sources = filter.sources && filter.sources.length > 0 ? new Set(filter.sources) : null;
    const difficulty = filter.difficulty && filter.difficulty.length > 0 ? new Set(filter.difficulty) : null;
    const needle = filter.q?.trim().toLowerCase() ?? "";
    return this.all().filter((q) => {
      if (categories && !categories.has(q.category)) return false;
      if (sources && !sources.has(q.source)) return false;
      if (difficulty && !difficulty.has(q.difficulty)) return false;
      if (needle) {
        const haystack = [q.stem, ...q.options.map((o) => o.text)].join("\n").toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }

  counts(): QuestionCounts {
    const bySource = Object.fromEntries(QUESTION_SOURCES.map((s) => [s, 0])) as Record<QuestionSource, number>;
    const byCategory = Object.fromEntries(CATEGORY_IDS.map((c) => [c, 0])) as Record<CategoryId, number>;
    for (const q of this.all()) {
      bySource[q.source] += 1;
      byCategory[q.category] += 1;
    }
    return { total: this.size(), bySource, byCategory };
  }

  mintId(source: QuestionSource): string {
    for (;;) {
      this.mintCounter += 1;
      const id = `${ID_PREFIX[source]}-${Date.now().toString(36)}-${this.mintCounter}`;
      if (!this.has(id)) return id;
    }
  }

  /**
   * Adds already-validated questions to the learner's bank. A question whose id is empty or
   * already in use gets a fresh id. Returns the questions as stored.
   */
  async addMany(questions: readonly Question[]): Promise<Question[]> {
    const stored: Question[] = [];
    for (const incoming of questions) {
      const question = { ...incoming };
      if (!question.id || this.has(question.id)) question.id = this.mintId(question.source);
      this.own.set(question.id, question);
      stored.push(question);
    }
    if (stored.length > 0) await this.persist();
    return stored;
  }

  async delete(id: string): Promise<DeleteResult> {
    if (this.seeded.has(id)) return "bundled";
    if (!this.own.delete(id)) return "missing";
    await this.persist();
    return "deleted";
  }

  private persist(): Promise<void> {
    return this.file.save({ version: 1, questions: [...this.own.values()] });
  }
}
