import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createApp, type Generator } from "../../src/server/app.js";
import { GeneratorError, type GeneratorContext } from "../../src/server/generator/index.js";
import { PROJECT_ROOT } from "../../src/server/paths.js";
import type { GenerateRequest, GenerateResponse, Question, StudySource } from "../../src/shared/types.js";

const SEED_DIR = path.join(PROJECT_ROOT, "tests", "fixtures", "seed");

async function startServer(options: { envApiKey?: string; generator?: Generator } = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "nclex-generate-"));
  const { app, stores } = createApp({ dataDir, seedDir: SEED_DIR, version: "test", warn: () => undefined, ...options });
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    stores,
    dataDir,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

type Server = Awaited<ReturnType<typeof startServer>>;

async function call<T = unknown>(base: string, url: string, method = "GET", body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(base + url, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

function generated(n: number, overrides: Partial<Question> = {}): Question {
  return {
    id: `ai-test-${n}`,
    stem: `Generated question number ${n}: which nursing action is the priority for this client?`,
    options: [
      { label: "A", text: `Action A for ${n}`, rationale: `Rationale for A on question ${n}.` },
      { label: "B", text: `Action B for ${n}`, rationale: `Rationale for B on question ${n}.` },
      { label: "C", text: `Action C for ${n}`, rationale: `Rationale for C on question ${n}.` },
    ],
    correct: "B",
    category: "reduction_of_risk_potential",
    subtopic: "Laboratory Values",
    difficulty: "medium",
    source: "ai",
    createdAt: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

interface Call {
  request: GenerateRequest;
  ctx: GeneratorContext;
}

function fakeGenerator(calls: Call[], respond: (request: GenerateRequest, ctx: GeneratorContext) => Promise<GenerateResponse>): Generator {
  return {
    generateQuestions: async (request, ctx) => {
      calls.push({ request, ctx });
      return respond(request, ctx);
    },
    verifyApiKey: async () => ({ ok: true }),
  };
}

describe("POST /api/generate", () => {
  let s: Server;
  const calls: Call[] = [];
  let respond: (request: GenerateRequest, ctx: GeneratorContext) => Promise<GenerateResponse> = async (request) => ({
    questions: Array.from({ length: request.count }, (_, i) => generated(i + 1)),
    model: "claude-test",
    usage: { inputTokens: 100, outputTokens: 200 },
    warnings: [],
  });
  let source: StudySource;
  let otherSource: StudySource;

  before(async () => {
    s = await startServer({ generator: fakeGenerator(calls, (request, ctx) => respond(request, ctx)) });
    source = (await call<StudySource>(s.base, "/api/sources", "POST", { name: "Fluids", text: "Isotonic fluids include 0.9% sodium chloride and lactated Ringer's solution." })).body;
    otherSource = (await call<StudySource>(s.base, "/api/sources", "POST", { name: "Unrelated", text: "This source should not be sent to the generator." })).body;
  });
  after(() => s.close());

  it("400 no_api_key when neither env nor settings has a key", async () => {
    const { status, body } = await call<{ code: string; error: string }>(s.base, "/api/generate", "POST", { count: 2 });
    assert.equal(status, 400);
    assert.equal(body.code, "no_api_key");
    assert.match(body.error, /Settings/);
    assert.equal(calls.length, 0);
  });

  it("validates the request before touching the generator", async () => {
    await call(s.base, "/api/settings/api-key", "PUT", { apiKey: "sk-ant-test-key-000000000000-abcd" });
    const noCount = await call<{ code: string }>(s.base, "/api/generate", "POST", {});
    assert.equal(noCount.status, 400);
    assert.equal(noCount.body.code, "missing_count");
    const tooMany = await call<{ code: string }>(s.base, "/api/generate", "POST", { count: 21 });
    assert.equal(tooMany.status, 400);
    const badStep = await call<{ code: string }>(s.base, "/api/generate", "POST", { count: 1, clinicalJudgmentSteps: ["guess"] });
    assert.equal(badStep.status, 400);
    assert.equal(badStep.body.code, "invalid_clinicalJudgmentSteps");
    const badSource = await call<{ code: string }>(s.base, "/api/generate", "POST", { count: 1, sourceIds: ["src-nope-1"] });
    assert.equal(badSource.status, 400);
    assert.equal(badSource.body.code, "unknown_source");
    assert.equal(calls.length, 0);
  });

  it("generates, validates and saves questions", async () => {
    const { status, body } = await call<GenerateResponse>(s.base, "/api/generate", "POST", {
      count: 3,
      categories: ["reduction_of_risk_potential"],
      difficulty: "medium",
      focus: "  lab values  ",
      sourceIds: [source.id],
    });
    assert.equal(status, 200);
    assert.equal(body.questions.length, 3);
    assert.equal(body.model, "claude-test");
    assert.deepEqual(body.usage, { inputTokens: 100, outputTokens: 200 });
    assert.deepEqual(body.warnings, []);
    assert.ok(body.questions.every((q) => q.source === "ai"));

    const last = calls.at(-1);
    assert.ok(last);
    assert.deepEqual(last.request, { count: 3, categories: ["reduction_of_risk_potential"], difficulty: "medium", focus: "lab values", sourceIds: [source.id] });
    assert.equal(last.ctx.apiKey, "sk-ant-test-key-000000000000-abcd");
    assert.equal(last.ctx.model, "claude-opus-5");
    assert.equal(last.ctx.stats, undefined);
    assert.equal(last.ctx.existingStems?.length, 24);
    assert.deepEqual(last.ctx.sources.map((src) => src.id), [source.id]);
    assert.equal(last.ctx.sources[0]?.name, "Fluids");
    assert.ok(last.ctx.sources[0]?.text.includes("lactated Ringer"));
    assert.ok(!last.ctx.sources.some((src) => src.id === otherSource.id));

    const bank = await call<{ questions: Question[]; counts: { bySource: { ai: number } } }>(s.base, "/api/questions?source=ai");
    assert.equal(bank.body.counts.bySource.ai, 3);
    assert.deepEqual(bank.body.questions.map((q) => q.id).sort(), ["ai-test-1", "ai-test-2", "ai-test-3"]);
    const saved = JSON.parse(await readFile(path.join(s.dataDir, "questions.json"), "utf8")) as { questions: Question[] };
    assert.equal(saved.questions.length, 3);
    const health = await call<{ questionCount: number }>(s.base, "/api/health");
    assert.equal(health.body.questionCount, 27);
  });

  it("re-mints ids that already exist and passes stats when targeting weak areas", async () => {
    const { body } = await call<GenerateResponse>(s.base, "/api/generate", "POST", { count: 1, targetWeakAreas: true });
    assert.equal(body.questions.length, 1);
    assert.notEqual(body.questions[0]?.id, "ai-test-1");
    assert.ok(calls.at(-1)?.ctx.stats, "stats passed");
    assert.equal(calls.at(-1)?.ctx.stats?.totalAttempted, 0);
    assert.equal(calls.at(-1)?.ctx.existingStems?.length, 27);
    const bank = await call<{ counts: { bySource: { ai: number } } }>(s.base, "/api/questions");
    assert.equal(bank.body.counts.bySource.ai, 4);
  });

  it("drops invalid questions with a warning and passes generator warnings through", async () => {
    respond = async () => ({
      questions: [
        generated(10, { id: "" }),
        { ...generated(11), correct: "D" as unknown as "A" },
        { ...generated(12), options: generated(12).options.slice(0, 2) },
      ],
      model: "claude-test",
      usage: { inputTokens: 1, outputTokens: 2 },
      warnings: ["Model retried once."],
      researchBrief: "Brief text.",
    });
    const { status, body } = await call<GenerateResponse>(s.base, "/api/generate", "POST", { count: 3, research: true });
    assert.equal(status, 200);
    assert.equal(body.questions.length, 1);
    assert.match(body.questions[0]?.id ?? "", /^ai-/);
    assert.equal(body.researchBrief, "Brief text.");
    assert.equal(body.warnings[0], "Model retried once.");
    assert.equal(body.warnings.length, 3);
    assert.ok(body.warnings[1]?.includes("Dropped generated question 2"));
    assert.ok(body.warnings[2]?.includes("Dropped generated question 3"));
    assert.equal(calls.at(-1)?.request.research, true);
  });

  it("does not save when save is false", async () => {
    respond = async () => ({ questions: [generated(20)], model: "claude-test", usage: { inputTokens: 1, outputTokens: 1 }, warnings: [] });
    const before = (await call<{ counts: { bySource: { ai: number } } }>(s.base, "/api/questions")).body.counts.bySource.ai;
    const { body } = await call<GenerateResponse>(s.base, "/api/generate", "POST", { count: 1, save: false });
    assert.equal(body.questions.length, 1);
    assert.equal(body.questions[0]?.id, "ai-test-20");
    const after_ = (await call<{ counts: { bySource: { ai: number } } }>(s.base, "/api/questions")).body.counts.bySource.ai;
    assert.equal(after_, before);
    assert.equal(calls.at(-1)?.request.save, false);
  });

  it("maps GeneratorError to its status and code, other errors to 500", async () => {
    respond = async () => {
      throw new GeneratorError("Your Anthropic account has no credit.", 402, "billing");
    };
    const billing = await call<{ error: string; code: string }>(s.base, "/api/generate", "POST", { count: 1 });
    assert.equal(billing.status, 402);
    assert.deepEqual(billing.body, { error: "Your Anthropic account has no credit.", code: "billing" });

    respond = async () => {
      throw new GeneratorError("Rate limited.", 429, "rate_limited");
    };
    const limited = await call<{ code: string }>(s.base, "/api/generate", "POST", { count: 1 });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.code, "rate_limited");

    // 5xx generator errors are still ours: the learner needs the message ("offline?"), not a generic 500.
    respond = async () => {
      throw new GeneratorError("Could not reach the Claude API - is this computer online?", 502, "unreachable");
    };
    const offline = await call<{ error: string; code: string }>(s.base, "/api/generate", "POST", { count: 1 });
    assert.equal(offline.status, 502);
    assert.deepEqual(offline.body, { error: "Could not reach the Claude API - is this computer online?", code: "unreachable" });

    const originalError = console.error;
    console.error = () => undefined;
    try {
      respond = async () => {
        throw new Error("boom");
      };
      const crash = await call<{ error: string; code: string }>(s.base, "/api/generate", "POST", { count: 1 });
      assert.equal(crash.status, 500);
      assert.equal(crash.body.code, "internal_error");
      assert.ok(!crash.body.error.includes("boom"));
    } finally {
      console.error = originalError;
    }
  });
});

describe("POST /api/generate with an environment key", () => {
  it("uses the env key even when a different key is saved", async () => {
    const calls: Call[] = [];
    const s = await startServer({
      envApiKey: "sk-ant-env-0000000000000000-env1",
      generator: fakeGenerator(calls, async () => ({ questions: [], model: "m", usage: { inputTokens: 0, outputTokens: 0 }, warnings: [] })),
    });
    try {
      await s.stores.settings.setApiKey("sk-ant-saved-000000000000-save");
      const { status, body } = await call<GenerateResponse>(s.base, "/api/generate", "POST", { count: 1 });
      assert.equal(status, 200);
      assert.deepEqual(body.questions, []);
      assert.equal(calls[0]?.ctx.apiKey, "sk-ant-env-0000000000000000-env1");
    } finally {
      await s.close();
    }
  });
});
