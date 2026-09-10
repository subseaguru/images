/**
 * Claude-powered question generator (contract).
 *
 * The server calls `generateQuestions` and `verifyApiKey`; the implementation lives in this
 * directory. Everything the generator needs is passed in through `GeneratorContext` so it can be
 * unit-tested with a mocked `fetch` and has no dependency on the on-disk stores.
 */
import type { GenerateRequest, GenerateResponse, Stats } from "../../shared/types.js";

export interface GeneratorSource {
  id: string;
  name: string;
  /** Full extracted text of the study source. */
  text: string;
}

export interface GeneratorContext {
  apiKey: string;
  /** Claude model id, e.g. "claude-opus-5". */
  model: string;
  /** Study sources selected by the user (already filtered to `request.sourceIds`). */
  sources: GeneratorSource[];
  /** Learner statistics, used when `request.targetWeakAreas` is set. */
  stats?: Stats;
  /** Stems already in the bank, so new questions do not duplicate them. */
  existingStems?: string[];
  /** Clock override for deterministic ids/timestamps in tests. */
  now?: () => Date;
  /** Custom fetch (tests) - passed straight to the Anthropic client. */
  fetch?: typeof globalThis.fetch;
  /** API base URL override (tests). */
  baseURL?: string;
}

/** Error with an HTTP status the API layer can forward to the browser. */
export class GeneratorError extends Error {
  constructor(
    message: string,
    public readonly status: number = 500,
    public readonly code: string = "generator_error",
  ) {
    super(message);
    this.name = "GeneratorError";
  }
}

export async function generateQuestions(
  _request: GenerateRequest,
  _ctx: GeneratorContext,
): Promise<GenerateResponse> {
  throw new GeneratorError("Question generation is not implemented yet.", 501, "not_implemented");
}

export interface VerifyApiKeyResult {
  ok: boolean;
  /** Human-readable problem when `ok` is false. */
  error?: string;
}

export async function verifyApiKey(
  _apiKey: string,
  _model: string,
  _opts: { fetch?: typeof globalThis.fetch; baseURL?: string } = {},
): Promise<VerifyApiKeyResult> {
  return { ok: false, error: "Not implemented yet." };
}
