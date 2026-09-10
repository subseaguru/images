/**
 * Attempt history (`attempts.json`) and the statistics derived from it.
 */
import type { Attempt, CategoryId, CategoryStats, SessionSummary, Stats } from "../../shared/types.js";
import { CATEGORY_IDS } from "../../shared/types.js";
import { JsonFile } from "../storage/jsonFile.js";

interface AttemptsFile {
  version: 1;
  attempts: Attempt[];
}

export const WEAK_MIN_ATTEMPTS = 3;
export const WEAK_ACCURACY_THRESHOLD = 0.7;
export const MAX_RECENT_SESSIONS = 20;
export const RECENT_DAYS = 7;

export class AttemptStore {
  private attempts: Attempt[];
  private readonly file: JsonFile<AttemptsFile>;

  constructor(filePath: string, warn: (message: string) => void = (m) => console.warn(m)) {
    this.file = new JsonFile<AttemptsFile>(filePath, () => ({ version: 1, attempts: [] }));
    let data: AttemptsFile;
    try {
      data = this.file.loadSync();
    } catch (err) {
      warn(`Could not read ${filePath} (${(err as Error).message}); starting with no attempts.`);
      data = { version: 1, attempts: [] };
    }
    this.attempts = Array.isArray(data.attempts) ? data.attempts : [];
  }

  list(): Attempt[] {
    return [...this.attempts];
  }

  bySession(sessionId: string): Attempt[] {
    return this.attempts.filter((a) => a.sessionId === sessionId);
  }

  async add(attempt: Attempt): Promise<void> {
    this.attempts.push(attempt);
    await this.persist();
  }

  async clear(): Promise<void> {
    this.attempts = [];
    await this.persist();
  }

  private persist(): Promise<void> {
    return this.file.save({ version: 1, attempts: this.attempts });
  }
}

function accuracyOf(correct: number, attempted: number): number | null {
  return attempted === 0 ? null : correct / attempted;
}

export function summarizeSession(sessionId: string, attempts: readonly Attempt[]): SessionSummary {
  const own = attempts.filter((a) => a.sessionId === sessionId);
  const startedAt = own.reduce((min, a) => (a.answeredAt < min ? a.answeredAt : min), own[0]?.answeredAt ?? "");
  return {
    sessionId,
    startedAt,
    answered: own.length,
    correct: own.filter((a) => a.isCorrect).length,
  };
}

export function computeStats(attempts: readonly Attempt[]): Stats {
  const byCategory: CategoryStats[] = CATEGORY_IDS.map((category) => {
    const own = attempts.filter((a) => a.category === category);
    const correct = own.filter((a) => a.isCorrect).length;
    return { category, attempted: own.length, correct, accuracy: accuracyOf(correct, own.length) };
  });

  const weakCategories: CategoryId[] = byCategory
    .filter((c) => c.attempted >= WEAK_MIN_ATTEMPTS && (c.accuracy ?? 1) < WEAK_ACCURACY_THRESHOLD)
    .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0) || b.attempted - a.attempted)
    .map((c) => c.category);

  const sessionIds = [...new Set(attempts.map((a) => a.sessionId))];
  const recentSessions = sessionIds
    .map((id) => summarizeSession(id, attempts))
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))
    .slice(0, MAX_RECENT_SESSIONS);

  const totalCorrect = attempts.filter((a) => a.isCorrect).length;
  return {
    totalAttempted: attempts.length,
    totalCorrect,
    accuracy: accuracyOf(totalCorrect, attempts.length),
    byCategory,
    recentSessions,
    weakCategories,
  };
}

/** Ids of questions answered within the last `days` days. */
export function recentlyAnsweredIds(
  attempts: readonly Attempt[],
  days: number = RECENT_DAYS,
  now: number = Date.now(),
): Set<string> {
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const ids = new Set<string>();
  for (const a of attempts) {
    const at = Date.parse(a.answeredAt);
    if (!Number.isNaN(at) && at >= cutoff) ids.add(a.questionId);
  }
  return ids;
}
