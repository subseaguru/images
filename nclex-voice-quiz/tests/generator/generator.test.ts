import { test } from "node:test";
import assert from "node:assert/strict";
import type { Stats } from "../../src/shared/types.js";
import { CATEGORY_IDS } from "../../src/shared/types.js";
import { blueprintDistribution } from "../../src/shared/blueprint.js";
import {
  GeneratorError,
  generateQuestions,
  verifyApiKey,
  type GeneratorContext,
} from "../../src/server/generator/index.js";
import {
  BASE_URL,
  batchResponse,
  errorResponse,
  fakeApi,
  generatedQuestion,
  messageBody,
  textResponse,
  type RecordedRequest,
} from "./fake-api.js";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const MODEL = "claude-opus-5";

function context(api: ReturnType<typeof fakeApi>, extra: Partial<GeneratorContext> = {}): GeneratorContext {
  return {
    apiKey: "sk-ant-test",
    model: MODEL,
    sources: [],
    now: () => NOW,
    fetch: api.fetch,
    baseURL: BASE_URL,
    ...extra,
  };
}

function messagesRequests(api: ReturnType<typeof fakeApi>): RecordedRequest[] {
  return api.requests.filter((r) => r.url.startsWith(`${BASE_URL}/v1/messages`));
}

function userText(req: RecordedRequest): string {
  const messages = req.body!.messages as { role: string; content: unknown }[];
  const first = messages[0]!;
  return typeof first.content === "string" ? first.content : JSON.stringify(first.content);
}

async function expectGeneratorError(promise: Promise<unknown>): Promise<GeneratorError> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof GeneratorError, `expected GeneratorError, got ${String(err)}`);
    return err;
  }
  assert.fail("expected the promise to reject");
}

test("happy path: returns Question objects, model and usage", async () => {
  const batch = { questions: [generatedQuestion(), generatedQuestion({ correct: "B" }), generatedQuestion({ correct: "C" })] };
  const api = fakeApi([batchResponse(batch, { model: "claude-opus-5-served", usage: { cache_read_input_tokens: 300, cache_creation_input_tokens: 50 } })]);

  const result = await generateQuestions({ count: 3 }, context(api));

  assert.equal(result.questions.length, 3);
  result.questions.forEach((q, i) => {
    assert.equal(q.id, `ai-${NOW.getTime()}-${i}`);
    assert.equal(q.source, "ai");
    assert.equal(q.createdAt, NOW.toISOString());
    assert.equal(q.options.length, 3);
    assert.ok(q.stem.length > 20);
  });
  assert.deepEqual(result.questions.map((q) => q.correct), ["A", "B", "C"]);
  assert.equal(result.model, "claude-opus-5-served");
  assert.deepEqual(result.usage, { inputTokens: 1200 + 300 + 50, outputTokens: 800 });
  assert.deepEqual(result.warnings, []);
  assert.equal(result.researchBrief, undefined);
  assert.equal(api.requests.length, 1);
});

test("request body carries the betas, fallbacks, structured output, effort, cache_control, sources, stems and plan", async () => {
  const api = fakeApi([batchResponse({ questions: [generatedQuestion()] })]);
  const stats: Stats = {
    totalAttempted: 30,
    totalCorrect: 15,
    accuracy: 0.5,
    byCategory: CATEGORY_IDS.map((category) => ({ category, attempted: 4, correct: 2, accuracy: 0.5 })),
    recentSessions: [],
    weakCategories: ["psychosocial_integrity"],
  };

  await generateQuestions(
    { count: 6, difficulty: "hard", focus: "insulin", targetWeakAreas: true },
    context(api, {
      sources: [{ id: "s1", name: "Pharm notes", text: "Regular insulin peaks in 2 to 3 hours." }],
      existingStems: ["An existing stem about restraints. Which action is appropriate?"],
      stats,
    }),
  );

  const req = api.requests[0]!;
  assert.equal(req.method, "POST");
  assert.ok(req.url.startsWith(`${BASE_URL}/v1/messages`), req.url);
  assert.equal(req.headers["x-api-key"], "sk-ant-test");
  const betas = req.headers["anthropic-beta"] ?? "";
  assert.ok(betas.includes("server-side-fallback-2026-07-01"), betas);

  const body = req.body!;
  assert.equal(body.model, MODEL);
  assert.equal(body.max_tokens, 16000);
  assert.equal(body.fallbacks, "default");
  assert.deepEqual(body.thinking, { type: "adaptive" });
  const outputConfig = body.output_config as { effort: string; format: { type: string; schema: Record<string, unknown> } };
  assert.equal(outputConfig.effort, "high");
  assert.equal(outputConfig.format.type, "json_schema");
  assert.equal(outputConfig.format.schema.type, "object");
  assert.equal(body.tools, undefined);

  const system = body.system as { type: string; text: string; cache_control?: unknown }[];
  assert.ok(Array.isArray(system));
  assert.ok(system.some((b) => b.cache_control !== undefined && JSON.stringify(b.cache_control) === '{"type":"ephemeral"}'));
  const systemText = system.map((b) => b.text).join("\n");
  assert.ok(systemText.includes("NCLEX-RN Test Plan"));
  assert.ok(systemText.includes("Establishing Priorities"));

  const user = userText(req);
  assert.ok(user.includes("Write 6 NCLEX-RN practice questions."));
  assert.ok(user.includes('<source name="Pharm notes">\nRegular insulin peaks in 2 to 3 hours.\n</source>'));
  assert.ok(user.includes("- An existing stem about restraints. Which action is appropriate?"));
  assert.ok(user.includes("Difficulty: hard."));
  assert.ok(user.includes("Focus: insulin."));
  assert.ok(user.includes("Psychosocial Integrity [psychosocial_integrity]: 50% correct"));
  // Per-category plan: every category with a quota is listed with its count and they sum to 6.
  const listed = [...user.matchAll(/\[([a-z_]+)\]: (\d+)$/gm)].map((m) => [m[1]!, Number(m[2])] as const);
  const plan = Object.fromEntries(listed.filter(([id]) => (CATEGORY_IDS as readonly string[]).includes(id)));
  assert.equal(Object.values(plan).reduce((a, b) => a + b, 0), 6);
  assert.ok(plan.psychosocial_integrity! > blueprintDistribution(6).psychosocial_integrity);
});

test("without categories the plan follows blueprintDistribution exactly", async () => {
  const api = fakeApi([batchResponse({ questions: [generatedQuestion()] })]);
  await generateQuestions({ count: 10 }, context(api));
  const user = userText(api.requests[0]!);
  const expected = blueprintDistribution(10);
  for (const id of CATEGORY_IDS) {
    if (expected[id] > 0) assert.ok(user.includes(`[${id}]: ${expected[id]}`), id);
  }
  assert.ok(user.includes("blueprint weighting"));
});

test("invalid entries are dropped with warnings", async () => {
  const batch = {
    questions: [
      generatedQuestion(),
      generatedQuestion({ correct: "D" }),
      generatedQuestion({ options: [{ label: "A", text: "only one", rationale: "r" }] }),
    ],
  };
  const api = fakeApi([batchResponse(batch)]);
  const result = await generateQuestions({ count: 3 }, context(api));
  assert.equal(result.questions.length, 1);
  assert.equal(result.warnings.filter((w) => w.includes("was dropped")).length, 2);
  assert.ok(result.warnings.some((w) => w.includes("Received 1 usable question of the 3 requested")));
});

test("duplicates of existing stems and within the batch are deduped", async () => {
  const stem = "A nurse is caring for a client on warfarin whose INR is 6.5 with gum bleeding. Which action should the nurse take first?";
  const batch = {
    questions: [
      generatedQuestion({ stem }),
      generatedQuestion({ stem: stem.toUpperCase() }),
      generatedQuestion({ stem: "  An   existing   stem. Which action is appropriate?  " }),
    ],
  };
  const api = fakeApi([batchResponse(batch)]);
  const result = await generateQuestions(
    { count: 3 },
    context(api, { existingStems: ["An existing stem. Which action is appropriate?"] }),
  );
  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0]!.stem, stem);
  assert.equal(result.warnings.filter((w) => w.includes("duplicate")).length, 2);
});

test("stop_reason refusal becomes a 422 GeneratorError with the explanation", async () => {
  const api = fakeApi([
    {
      body: messageBody({
        content: [],
        stop_reason: "refusal",
        stop_details: { type: "refusal", category: "general_harms", explanation: "policy" },
      }),
    },
  ]);
  const err = await expectGeneratorError(generateQuestions({ count: 2 }, context(api)));
  assert.equal(err.status, 422);
  assert.equal(err.code, "refused");
  assert.equal(err.message, "Claude declined this request: policy");
});

test("max_tokens with unparseable output retries once with half the count", async () => {
  const api = fakeApi([
    { body: messageBody({ content: [{ type: "text", text: '{"questions": [{"stem": "cut' }], stop_reason: "max_tokens" }) },
    batchResponse({ questions: [generatedQuestion()] }),
  ]);
  const result = await generateQuestions({ count: 7 }, context(api));
  assert.equal(api.requests.length, 2);
  assert.ok(userText(api.requests[0]!).includes("Write 7 NCLEX-RN practice questions."));
  assert.ok(userText(api.requests[1]!).includes("Write 4 NCLEX-RN practice questions."));
  assert.equal(result.questions.length, 1);
  assert.ok(result.warnings.some((w) => w.includes("retried asking for 4 questions")));
  assert.deepEqual(result.usage, { inputTokens: 2400, outputTokens: 1600 });
});

test("max_tokens with parseable output keeps it and warns", async () => {
  const api = fakeApi([batchResponse({ questions: [generatedQuestion()] }, { stop_reason: "max_tokens" })]);
  const result = await generateQuestions({ count: 1 }, context(api));
  assert.equal(api.requests.length, 1);
  assert.equal(result.questions.length, 1);
  assert.ok(result.warnings.some((w) => w.includes("output limit")));
});

test("a 401 from the API becomes a 401 GeneratorError", async () => {
  const api = fakeApi([errorResponse(401, "authentication_error", "invalid x-api-key")]);
  const err = await expectGeneratorError(generateQuestions({ count: 1 }, context(api)));
  assert.equal(err.status, 401);
  assert.equal(err.code, "invalid_api_key");
  assert.equal(err.message, "The Claude API rejected the API key. Check it in Settings.");
  assert.equal(api.requests.length, 1);
});

test("a 404 becomes unknown_model and a 400 carries the API message", async () => {
  const notFound = fakeApi([errorResponse(404, "not_found_error", "model: nope")]);
  const err404 = await expectGeneratorError(generateQuestions({ count: 1 }, context(notFound, { model: "nope" })));
  assert.equal(err404.status, 404);
  assert.equal(err404.code, "unknown_model");
  assert.ok(err404.message.includes('"nope"'));

  const bad = fakeApi([errorResponse(400, "invalid_request_error", "max_tokens is too large")]);
  const err400 = await expectGeneratorError(generateQuestions({ count: 1 }, context(bad)));
  assert.equal(err400.status, 400);
  assert.equal(err400.code, "bad_request");
  assert.ok(err400.message.includes("max_tokens is too large"));
});

test("a connection failure becomes 502 unreachable", async () => {
  const failingFetch: typeof globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  const err = await expectGeneratorError(
    generateQuestions({ count: 1 }, { apiKey: "sk-ant-test", model: MODEL, sources: [], fetch: failingFetch, baseURL: BASE_URL }),
  );
  assert.equal(err.status, 502);
  assert.equal(err.code, "unreachable");
});

test("a missing API key fails fast without calling the API", async () => {
  const api = fakeApi();
  const err = await expectGeneratorError(generateQuestions({ count: 1 }, context(api, { apiKey: "" })));
  assert.equal(err.status, 400);
  assert.equal(api.requests.length, 0);
});

test("research: a web-search call first, then generation with the brief in the user message", async () => {
  const api = fakeApi([
    textResponse("Brief: NCSBN emphasises clinical judgment (NCSBN 2026 test plan).", { usage: { input_tokens: 100, output_tokens: 50 } }),
    batchResponse({ questions: [generatedQuestion()] }),
  ]);
  const result = await generateQuestions({ count: 1, research: true, focus: "delegation" }, context(api));

  const [research, generation] = messagesRequests(api);
  assert.equal(api.requests.length, 2);

  const rb = research!.body!;
  assert.deepEqual(rb.tools, [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }]);
  assert.equal(rb.output_config && (rb.output_config as { format?: unknown }).format, undefined);
  assert.equal((rb.output_config as { effort: string }).effort, "medium");
  assert.equal(rb.fallbacks, "default");
  assert.equal(rb.max_tokens, 8000);
  assert.ok((research!.headers["anthropic-beta"] ?? "").includes("server-side-fallback-2026-07-01"));
  assert.ok(userText(research!).includes("delegation"));

  const gb = generation!.body!;
  assert.equal(gb.tools, undefined);
  assert.ok((gb.output_config as { format?: unknown }).format);
  assert.ok(userText(generation!).includes("<research_brief>\nBrief: NCSBN emphasises clinical judgment (NCSBN 2026 test plan).\n</research_brief>"));

  assert.equal(result.researchBrief, "Brief: NCSBN emphasises clinical judgment (NCSBN 2026 test plan).");
  assert.deepEqual(result.usage, { inputTokens: 1300, outputTokens: 850 });
});

test("research: pause_turn is continued by handing the content back", async () => {
  const paused = [
    { type: "text", text: "Part one." },
    { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "NCLEX test plan 2026" } },
  ];
  const api = fakeApi([
    { body: messageBody({ content: paused, stop_reason: "pause_turn" }) },
    textResponse("Part two."),
    batchResponse({ questions: [generatedQuestion()] }),
  ]);
  const result = await generateQuestions({ count: 1, research: true }, context(api));

  assert.equal(api.requests.length, 3);
  const second = api.requests[1]!.body!.messages as { role: string; content: unknown }[];
  assert.equal(second.length, 2);
  assert.equal(second[0]!.role, "user");
  assert.equal(second[1]!.role, "assistant");
  assert.deepEqual(second[1]!.content, paused);
  assert.equal(result.researchBrief, "Part one.\nPart two.");
});

test("research: a refusal is not fatal and is reported as a warning", async () => {
  const api = fakeApi([
    { body: messageBody({ content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: null } }) },
    batchResponse({ questions: [generatedQuestion()] }),
  ]);
  const result = await generateQuestions({ count: 1, research: true }, context(api));
  assert.equal(result.questions.length, 1);
  assert.equal(result.researchBrief, undefined);
  assert.ok(result.warnings.some((w) => w.includes("research was skipped")));
  assert.ok(!userText(api.requests[1]!).includes("<research_brief>"));
});

test("verifyApiKey: ok on a successful model lookup", async () => {
  const api = fakeApi([{ body: { id: MODEL, type: "model", display_name: "Claude Opus 5", created_at: "2026-04-01T00:00:00Z", capabilities: null } }]);
  const result = await verifyApiKey("sk-ant-test", MODEL, { fetch: api.fetch, baseURL: BASE_URL });
  assert.deepEqual(result, { ok: true });
  assert.equal(api.requests.length, 1);
  assert.equal(api.requests[0]!.method, "GET");
  assert.equal(api.requests[0]!.url, `${BASE_URL}/v1/models/${MODEL}`);
  assert.equal(api.requests[0]!.headers["x-api-key"], "sk-ant-test");
});

test("verifyApiKey: 401 and 404 produce friendly errors", async () => {
  const unauthorized = fakeApi([errorResponse(401, "authentication_error", "invalid x-api-key")]);
  const r401 = await verifyApiKey("sk-ant-bad", MODEL, { fetch: unauthorized.fetch, baseURL: BASE_URL });
  assert.equal(r401.ok, false);
  assert.ok(r401.error!.includes("rejected this API key"));

  const missing = fakeApi([errorResponse(404, "not_found_error", "model not found")]);
  const r404 = await verifyApiKey("sk-ant-test", "claude-nope", { fetch: missing.fetch, baseURL: BASE_URL });
  assert.equal(r404.ok, false);
  assert.ok(r404.error!.includes('"claude-nope"'));
});

test("verifyApiKey: connection problems and empty keys are reported without throwing", async () => {
  const failingFetch: typeof globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  const offline = await verifyApiKey("sk-ant-test", MODEL, { fetch: failingFetch, baseURL: BASE_URL });
  assert.equal(offline.ok, false);
  assert.ok(offline.error!.includes("Could not reach"));

  const empty = await verifyApiKey("   ", MODEL);
  assert.equal(empty.ok, false);
});
