/**
 * Claude-powered question generator.
 *
 * The server calls `generateQuestions` and `verifyApiKey`. Everything the generator needs is passed
 * in through `GeneratorContext` so it can be unit-tested with a mocked `fetch` and has no dependency
 * on the on-disk stores.
 *
 * Flow: (optional) research call with web search -> one structured-output generation call
 * (retried once with a smaller batch if the output was cut off) -> validation, dedupe and
 * conversion to `Question` objects.
 */
import Anthropic, { type APIError, type ClientOptions } from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { GenerateRequest, GenerateResponse, Stats } from "../../shared/types.js";
import {
  buildResearchUserMessage,
  buildSystemBlocks,
  buildUserMessage,
  clampCount,
  planCategoryCounts,
  prepareSources,
  RESEARCH_SYSTEM,
  weakAreasFrom,
} from "./prompt.js";
import { BatchSchema, parseBatchText, toQuestions } from "./schema.js";

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

/**
 * Server-side refusal fallback: if a safety classifier declines the request on the configured
 * model, the API re-runs it on Anthropic's recommended fallback model inside the same call. Kept
 * on deliberately - nursing content (overdoses, restraints, abuse) occasionally trips classifiers
 * and a fallback answer beats an error for the learner. The structured-outputs flag mirrors what
 * the SDK's own `parse()` helper sends.
 */
const FALLBACK_BETAS: Anthropic.Beta.AnthropicBeta[] = ["server-side-fallback-2026-07-01"];
const GENERATION_BETAS: Anthropic.Beta.AnthropicBeta[] = [...FALLBACK_BETAS, "structured-outputs-2025-12-15"];
const FALLBACKS = "default" as const;

const GENERATION_MAX_TOKENS = 16_000;
const RESEARCH_MAX_TOKENS = 8_000;
const RESEARCH_MAX_CONTINUATIONS = 3;
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

function makeClient(ctx: Pick<GeneratorContext, "apiKey" | "fetch" | "baseURL">, overrides: Partial<ClientOptions> = {}) {
  return new Anthropic({
    apiKey: ctx.apiKey,
    baseURL: ctx.baseURL,
    fetch: ctx.fetch,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 2,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------------------------

/** Translate SDK errors into `GeneratorError`s with a status the browser can act on. Most specific first. */
export function toGeneratorError(err: unknown, model: string): GeneratorError {
  if (err instanceof GeneratorError) return err;
  if (err instanceof Anthropic.AuthenticationError) {
    return new GeneratorError("The Claude API rejected the API key. Check it in Settings.", 401, "invalid_api_key");
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new GeneratorError(
      `The Claude API does not recognise the model "${model}". Check the model id in Settings.`,
      404,
      "unknown_model",
    );
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new GeneratorError(
      "The Claude API is rate-limiting this key right now. Wait a minute and try again.",
      429,
      "rate_limited",
    );
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new GeneratorError(`The Claude API rejected the request: ${apiMessage(err)}`, 400, "bad_request");
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new GeneratorError("Could not reach the Claude API - is this computer online?", 502, "unreachable");
  }
  if (err instanceof Anthropic.APIError) {
    return new GeneratorError(`The Claude API returned an error: ${apiMessage(err)}`, err.status ?? 500, "api_error");
  }
  return new GeneratorError(err instanceof Error ? err.message : String(err), 500, "generator_error");
}

function apiMessage(err: APIError): string {
  const body = err.error as { error?: { message?: unknown } } | undefined;
  const inner = body?.error?.message;
  return typeof inner === "string" && inner ? inner : err.message;
}

// ---------------------------------------------------------------------------------------------
// Usage accounting
// ---------------------------------------------------------------------------------------------

interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
}

/** Cache reads and writes are input tokens too; the learner wants the true request size. */
function addUsage(total: UsageTotals, usage: Anthropic.Beta.BetaUsage | undefined): void {
  if (!usage) return;
  total.inputTokens +=
    (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  total.outputTokens += usage.output_tokens ?? 0;
}

function textOf(content: readonly Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function refusalMessage(msg: Anthropic.Beta.BetaMessage): string {
  const explanation = msg.stop_details?.explanation;
  return `Claude declined this request${explanation ? `: ${explanation}` : ""}`;
}

// ---------------------------------------------------------------------------------------------
// Research step
// ---------------------------------------------------------------------------------------------

interface ResearchResult {
  brief?: string;
  warnings: string[];
}

/**
 * Ask Claude to compile a short brief with web search before writing questions. Web search and
 * structured output are never combined in one call, so this is a separate plain-text request.
 * A refusal or an empty answer here is not fatal: generation proceeds without the brief.
 */
async function runResearch(
  client: Anthropic,
  model: string,
  userText: string,
  usage: UsageTotals,
): Promise<ResearchResult> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: userText }];
  const chunks: string[] = [];

  for (let turn = 0; turn <= RESEARCH_MAX_CONTINUATIONS; turn += 1) {
    const res = await client.beta.messages.create({
      model,
      max_tokens: RESEARCH_MAX_TOKENS,
      betas: FALLBACK_BETAS,
      fallbacks: FALLBACKS,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }],
      system: RESEARCH_SYSTEM,
      messages,
    });
    addUsage(usage, res.usage);

    if (res.stop_reason === "refusal") {
      return { warnings: [`Online research was skipped: ${refusalMessage(res)}.`] };
    }
    chunks.push(textOf(res.content));

    if (res.stop_reason !== "pause_turn") break;
    if (turn === RESEARCH_MAX_CONTINUATIONS) {
      return {
        brief: chunks.join("\n").trim() || undefined,
        warnings: ["Online research ran out of continuations; the brief may be incomplete."],
      };
    }
    // The paused turn is handed back verbatim so the server-side search loop can pick up where it left off.
    messages.push({ role: "assistant", content: res.content as Anthropic.Beta.BetaContentBlockParam[] });
  }

  const brief = chunks.join("\n").trim();
  if (!brief) return { warnings: ["Online research returned no text; questions were written without a brief."] };
  return { brief, warnings: [] };
}

// ---------------------------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------------------------

interface GenerationAttempt {
  msg: Anthropic.Beta.BetaMessage;
  entries: unknown[] | null;
}

async function callGenerate(
  client: Anthropic,
  model: string,
  system: Anthropic.Beta.BetaTextBlockParam[],
  userText: string,
  usage: UsageTotals,
): Promise<GenerationAttempt> {
  const format = betaZodOutputFormat(BatchSchema);
  // `create` rather than the SDK's `parse` helper: `parse` throws on any text that is not valid
  // JSON, which would hide the stop reason on a refusal or a cut-off answer. We read stop_reason
  // first and only then interpret the text.
  const msg = await client.beta.messages.create({
    model,
    max_tokens: GENERATION_MAX_TOKENS,
    betas: GENERATION_BETAS,
    fallbacks: FALLBACKS,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format },
    system,
    messages: [{ role: "user", content: userText }],
  });
  addUsage(usage, msg.usage);

  if (msg.stop_reason === "refusal") {
    throw new GeneratorError(refusalMessage(msg), 422, "refused");
  }
  const entries = parseBatchText(textOf(msg.content))?.questions ?? null;
  return { msg, entries };
}

export async function generateQuestions(request: GenerateRequest, ctx: GeneratorContext): Promise<GenerateResponse> {
  if (!ctx.apiKey?.trim()) {
    throw new GeneratorError("No Claude API key is configured. Add one in Settings.", 400, "no_api_key");
  }
  const model = ctx.model?.trim();
  if (!model) throw new GeneratorError("No Claude model is configured. Set one in Settings.", 400, "no_model");

  const client = makeClient(ctx);
  const warnings: string[] = [];
  const usage: UsageTotals = { inputTokens: 0, outputTokens: 0 };
  const count = clampCount(request.count);
  const weakAreas = request.targetWeakAreas ? weakAreasFrom(ctx.stats, request.categories) : [];
  const counts = planCategoryCounts(count, request.categories, weakAreas);
  const prepared = prepareSources(ctx.sources ?? []);
  warnings.push(...prepared.warnings);
  const existingStems = ctx.existingStems ?? [];
  const system = buildSystemBlocks();

  try {
    let researchBrief: string | undefined;
    if (request.research) {
      const research = await runResearch(client, model, buildResearchUserMessage({ request, counts }), usage);
      researchBrief = research.brief;
      warnings.push(...research.warnings);
    }

    const userFor = (n: number, perCategory: typeof counts) =>
      buildUserMessage({
        request,
        count: n,
        counts: perCategory,
        weakAreas,
        researchBrief,
        sources: prepared.sources,
        existingStems,
      });

    let attempt = await callGenerate(client, model, system, userFor(count, counts), usage);

    if (attempt.msg.stop_reason === "max_tokens") {
      if (attempt.entries === null) {
        // The answer was cut off before the JSON closed: ask for a smaller batch once.
        const smaller = Math.max(1, Math.ceil(count / 2));
        warnings.push(
          `Claude's answer was cut off at the output limit; retried asking for ${smaller} question${smaller === 1 ? "" : "s"} instead of ${count}.`,
        );
        const smallerCounts = planCategoryCounts(smaller, request.categories, weakAreas);
        attempt = await callGenerate(client, model, system, userFor(smaller, smallerCounts), usage);
        if (attempt.msg.stop_reason === "max_tokens" && attempt.entries === null) {
          throw new GeneratorError(
            "Claude's answer was cut off twice before it produced complete questions. Try fewer questions or fewer study sources.",
            502,
            "truncated",
          );
        }
      } else {
        warnings.push("Claude hit the output limit; the batch may be shorter than requested.");
      }
    }

    if (attempt.entries === null) {
      throw new GeneratorError("Claude's answer was not the expected JSON. Try again.", 502, "bad_output");
    }

    const now = ctx.now?.() ?? new Date();
    const converted = toQuestions(attempt.entries, { now, existingStems });
    warnings.push(...converted.warnings);
    if (converted.questions.length === 0) {
      warnings.push("Every generated question was dropped during validation.");
    } else if (converted.questions.length < count) {
      warnings.push(`Received ${converted.questions.length} usable question${converted.questions.length === 1 ? "" : "s"} of the ${count} requested.`);
    }

    const response: GenerateResponse = {
      questions: converted.questions,
      model: attempt.msg.model,
      usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
      warnings,
    };
    if (researchBrief) response.researchBrief = researchBrief;
    return response;
  } catch (err) {
    throw toGeneratorError(err, model);
  }
}

// ---------------------------------------------------------------------------------------------
// API key verification
// ---------------------------------------------------------------------------------------------

export interface VerifyApiKeyResult {
  ok: boolean;
  /** Human-readable problem when `ok` is false. */
  error?: string;
}

export async function verifyApiKey(
  apiKey: string,
  model: string,
  opts: { fetch?: typeof globalThis.fetch; baseURL?: string } = {},
): Promise<VerifyApiKeyResult> {
  if (!apiKey?.trim()) return { ok: false, error: "No API key was provided." };
  if (!model?.trim()) return { ok: false, error: "No model id was provided." };
  const client = makeClient({ apiKey, fetch: opts.fetch, baseURL: opts.baseURL }, { timeout: 30_000, maxRetries: 1 });
  try {
    await client.models.retrieve(model.trim());
    return { ok: true };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: "The Claude API rejected this API key. Check that it was copied completely." };
    }
    if (err instanceof Anthropic.NotFoundError) {
      return { ok: false, error: `The key works, but the Claude API does not recognise the model "${model}".` };
    }
    if (err instanceof Anthropic.PermissionDeniedError) {
      return { ok: false, error: "This API key is not allowed to use the Claude API. Check its permissions in the Anthropic console." };
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { ok: false, error: "The Claude API is rate-limiting this key right now. Wait a minute and try again." };
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return { ok: false, error: "Could not reach the Claude API - is this computer online?" };
    }
    if (err instanceof Anthropic.APIError) {
      return { ok: false, error: `The Claude API returned an error (${err.status ?? "unknown"}): ${apiMessage(err)}` };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
