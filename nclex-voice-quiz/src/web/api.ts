/**
 * Typed fetch wrappers for every endpoint in docs/API.md. Errors are surfaced as `ApiError`
 * carrying the server's `{ error, code }` so views can branch on the code (e.g. `no_api_key`).
 */
import type {
  AttemptRequest,
  AttemptResponse,
  Attempt,
  Blueprint,
  CategoryId,
  Difficulty,
  GenerateRequest,
  GenerateResponse,
  Question,
  QuestionFile,
  QuestionSource,
  QuizStartRequest,
  QuizStartResponse,
  SessionSummary,
  Settings,
  Stats,
  StudySource,
  VoiceSettings,
} from "../shared/types.js";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface HealthResponse {
  ok: boolean;
  version: string;
  hasApiKey: boolean;
  questionCount: number;
}

export interface QuestionsResponse {
  questions: Question[];
  counts: {
    total: number;
    bySource: Record<QuestionSource, number>;
    byCategory: Record<CategoryId, number>;
  };
}

export interface QuestionFilters {
  category?: CategoryId[];
  source?: QuestionSource[];
  difficulty?: Difficulty[];
  q?: string;
  /** Only questions the importer flagged as missing a category or rationales. */
  needsReview?: boolean;
}

export interface ImportResponse {
  imported: number;
  /** Questions whose stem was already in the bank. */
  skippedDuplicates: number;
  rejected: { index: number; errors: string[] }[];
  /** How many imported questions still need a category or rationales. */
  needsReview: number;
  /** Options discarded from questions that arrived with more than three. */
  dropped: { index: number; options: string[] }[];
}

export interface EnrichResponse {
  updated: number;
  flagged: { id: string; concern: string }[];
  warnings: string[];
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface SessionResponse {
  sessionId: string;
  attempts: Attempt[];
  summary: SessionSummary;
}

export interface SettingsPatch {
  model?: string;
  voice?: Partial<VoiceSettings>;
  defaultCount?: number;
}

export interface VerifyKeyResponse {
  ok: boolean;
  error?: string;
  model: string;
}

async function parseError(response: Response): Promise<ApiError> {
  let message = `${response.status} ${response.statusText}`.trim();
  let code: string | undefined;
  try {
    const body = (await response.json()) as { error?: unknown; code?: unknown };
    if (typeof body.error === "string" && body.error) message = body.error;
    if (typeof body.code === "string") code = body.code;
  } catch {
    // Non-JSON error body (proxy page, empty body): keep the status text.
  }
  return new ApiError(message, response.status, code);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    throw new ApiError(`Could not reach the server (${(error as Error).message}).`, 0, "network");
  }
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as T;
}

function query(params: Record<string, string | string[] | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    for (const item of Array.isArray(value) ? value : [value]) search.append(key, item);
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const api = {
  health: () => request<HealthResponse>("GET", "/api/health"),
  blueprint: () => request<Blueprint>("GET", "/api/blueprint"),

  questions: (filters: QuestionFilters = {}) =>
    request<QuestionsResponse>(
      "GET",
      `/api/questions${query({
        category: filters.category,
        source: filters.source,
        difficulty: filters.difficulty,
        q: filters.q,
        needsReview: filters.needsReview ? "1" : undefined,
      })}`,
    ),
  question: (id: string) => request<Question>("GET", `/api/questions/${encodeURIComponent(id)}`),
  deleteQuestion: (id: string) => request<{ ok: true }>("DELETE", `/api/questions/${encodeURIComponent(id)}`),
  /**
   * The payload goes to the server exactly as the file contained it (a bare array included): the
   * server repairs question sets written by other tools, and doing that in one place keeps the
   * browser and `npm run import` behaving identically.
   */
  importQuestions: (payload: QuestionFile | { questions: unknown[] } | unknown[]) =>
    request<ImportResponse>("POST", "/api/questions/import", payload),
  enrichQuestions: (target: { ids: string[] } | { all: true }) =>
    request<EnrichResponse>("POST", "/api/questions/enrich", target),

  startQuiz: (body: QuizStartRequest) => request<QuizStartResponse>("POST", "/api/quiz/start", body),
  recordAttempt: (body: AttemptRequest) => request<AttemptResponse>("POST", "/api/attempts", body),
  session: (sessionId: string) => request<SessionResponse>("GET", `/api/sessions/${encodeURIComponent(sessionId)}`),
  stats: () => request<Stats>("GET", "/api/stats"),
  clearStats: () => request<{ ok: true }>("DELETE", "/api/stats"),

  sources: () => request<{ sources: StudySource[] }>("GET", "/api/sources"),
  source: (id: string) => request<{ source: StudySource; text: string }>("GET", `/api/sources/${encodeURIComponent(id)}`),
  addTextSource: (name: string, text: string) => request<StudySource>("POST", "/api/sources", { name, text }),
  addUrlSource: (url: string) => request<StudySource>("POST", "/api/sources/url", { url }),
  deleteSource: (id: string) => request<{ ok: true }>("DELETE", `/api/sources/${encodeURIComponent(id)}`),
  async uploadSource(file: File): Promise<StudySource> {
    let response: Response;
    try {
      response = await fetch(`/api/sources/upload?name=${encodeURIComponent(file.name)}`, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
    } catch (error) {
      throw new ApiError(`Could not reach the server (${(error as Error).message}).`, 0, "network");
    }
    if (!response.ok) throw await parseError(response);
    return (await response.json()) as StudySource;
  },

  settings: () => request<Settings>("GET", "/api/settings"),
  updateSettings: (patch: SettingsPatch) => request<Settings>("PUT", "/api/settings", patch),
  saveApiKey: (apiKey: string) => request<Settings>("PUT", "/api/settings/api-key", { apiKey }),
  removeApiKey: () => request<Settings>("DELETE", "/api/settings/api-key"),
  verifyApiKey: () => request<VerifyKeyResponse>("POST", "/api/settings/verify-key"),

  generate: (body: GenerateRequest) => request<GenerateResponse>("POST", "/api/generate", body),
};

/** Human-readable message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
