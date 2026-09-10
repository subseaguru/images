/**
 * Client-side state: a cached copy of the server settings and the quiz in progress.
 *
 * The quiz lives in `sessionStorage` so an accidental reload resumes the same session; when the
 * quiz ends it moves to a separate "results" slot so `#/results` survives a reload too. Nothing
 * here touches the DOM, so tests can drive it through `window.__nclex.state`.
 */
import type {
  CategoryId,
  Difficulty,
  InputMode,
  OptionLabel,
  Question,
  QuestionSource,
  QuizStartRequest,
  Settings,
} from "../shared/types.js";
import { api } from "./api.js";

const QUIZ_KEY = "nclex.quiz";
const RESULTS_KEY = "nclex.results";
const MIC_DENIED_KEY = "nclex.micDenied";

export interface QuizAnswer {
  questionId: string;
  category: CategoryId;
  chosen: OptionLabel;
  correct: OptionLabel;
  isCorrect: boolean;
  inputMode: InputMode;
  responseMs: number;
  /** True when POST /api/attempts failed and the verdict was computed locally. */
  unsaved?: boolean;
}

export interface QuizOptions {
  categories?: CategoryId[];
  sources?: QuestionSource[];
  difficulty?: Difficulty[];
  /** Voice on/off for this quiz (overrides the saved voice setting). */
  voice: boolean;
}

export interface QuizSession {
  sessionId: string;
  questions: Question[];
  /** Index of the question currently shown. */
  index: number;
  answers: QuizAnswer[];
  skipped: string[];
  options: QuizOptions;
  startedAt: string;
  finishedAt?: string;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (value === null || value === undefined) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be full or blocked (private mode); the in-memory copy still works for this page.
  }
}

let quiz: QuizSession | null = readJson<QuizSession>(QUIZ_KEY);
let results: QuizSession | null = readJson<QuizSession>(RESULTS_KEY);

function isSession(value: unknown): value is QuizSession {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Partial<QuizSession>;
  return typeof s.sessionId === "string" && Array.isArray(s.questions) && typeof s.index === "number" && Array.isArray(s.answers);
}

if (!isSession(quiz)) quiz = null;
if (!isSession(results)) results = null;

export function getQuiz(): QuizSession | null {
  return quiz;
}

export function getResults(): QuizSession | null {
  return results;
}

export function beginQuiz(sessionId: string, questions: Question[], options: QuizOptions): QuizSession {
  quiz = {
    sessionId,
    questions,
    index: 0,
    answers: [],
    skipped: [],
    options,
    startedAt: new Date().toISOString(),
  };
  writeJson(QUIZ_KEY, quiz);
  return quiz;
}

export function saveQuiz(session: QuizSession): void {
  quiz = session;
  writeJson(QUIZ_KEY, session);
}

/** End the quiz: whatever was answered becomes the results and the in-progress slot is cleared. */
export function finishQuiz(): QuizSession | null {
  if (!quiz) return results;
  results = { ...quiz, finishedAt: new Date().toISOString() };
  quiz = null;
  writeJson(QUIZ_KEY, null);
  writeJson(RESULTS_KEY, results);
  return results;
}

export function discardQuiz(): void {
  quiz = null;
  writeJson(QUIZ_KEY, null);
}

export function clearResults(): void {
  results = null;
  writeJson(RESULTS_KEY, null);
}

/** Remembered for the rest of the browser session so auto-listen stops nagging after a denial. */
export function isMicDenied(): boolean {
  try {
    return sessionStorage.getItem(MIC_DENIED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMicDenied(denied: boolean): void {
  try {
    if (denied) sessionStorage.setItem(MIC_DENIED_KEY, "1");
    else sessionStorage.removeItem(MIC_DENIED_KEY);
  } catch {
    // Ignore.
  }
}

// ---------------------------------------------------------------------------------------------
// Settings cache
// ---------------------------------------------------------------------------------------------

export const DEFAULT_SETTINGS: Settings = {
  model: "claude-opus-5",
  hasApiKey: false,
  apiKeyFromEnv: false,
  voice: { enabled: true, rate: 1, autoListen: true, readRationale: true },
  defaultCount: 10,
};

let settings: Settings | null = null;
let settingsPromise: Promise<Settings> | null = null;

/** Load settings once per page; `force` re-fetches (used after saving). Falls back to defaults offline. */
export function loadSettings(force = false): Promise<Settings> {
  if (settings && !force) return Promise.resolve(settings);
  if (!settingsPromise || force) {
    settingsPromise = api
      .settings()
      .then((loaded) => {
        settings = loaded;
        return loaded;
      })
      .catch(() => settings ?? DEFAULT_SETTINGS)
      .finally(() => {
        settingsPromise = null;
      });
  }
  return settingsPromise;
}

export function cachedSettings(): Settings {
  return settings ?? DEFAULT_SETTINGS;
}

export function setSettings(next: Settings): void {
  settings = next;
}

/** Build the request body for a quiz from the Home form choices. */
export function quizRequest(count: number, options: QuizOptions): QuizStartRequest {
  const body: QuizStartRequest = { count };
  if (options.categories && options.categories.length > 0) body.categories = options.categories;
  if (options.sources && options.sources.length > 0) body.sources = options.sources;
  if (options.difficulty && options.difficulty.length > 0) body.difficulty = options.difficulty;
  return body;
}
