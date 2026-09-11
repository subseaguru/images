/**
 * Enrichment must only ever add explanation. These tests pin the two properties that matter:
 * the question itself (stem, options, keyed answer) is copied from the original no matter what
 * the model returns, and a question Claude has a concern about is left completely untouched.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enrichQuestions, ENRICH_BATCH_SIZE } from "../../src/server/generator/enrich.js";
import { PLACEHOLDER_RATIONALE, PLACEHOLDER_SUBTOPIC } from "../../src/server/questions/normalize.js";
import type { Question } from "../../src/shared/types.js";
import { BASE_URL, errorResponse, fakeApi, textResponse } from "./fake-api.js";

function imported(overrides: Partial<Question> = {}): Question {
  return {
    id: "imported-1",
    stem: "A nurse is caring for a client who received regular insulin 30 minutes ago and is now sweating, shaky and confused. Which action should the nurse take first?",
    options: [
      { label: "A", text: "Give 15 grams of a fast-acting carbohydrate.", rationale: PLACEHOLDER_RATIONALE },
      { label: "B", text: "Administer the scheduled long-acting insulin.", rationale: PLACEHOLDER_RATIONALE },
      { label: "C", text: "Notify the provider and wait for orders.", rationale: PLACEHOLDER_RATIONALE },
    ],
    correct: "A",
    category: "management_of_care",
    subtopic: PLACEHOLDER_SUBTOPIC,
    difficulty: "medium",
    source: "imported",
    needsReview: true,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function answer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "imported-1",
    category: "pharmacological_and_parenteral_therapies",
    subtopic: "Adverse Effects/Contraindications/Side Effects/Interactions",
    clinicalJudgmentStep: "take_action",
    difficulty: "hard",
    rationales: [
      { label: "A", rationale: "Fifteen grams of fast-acting carbohydrate treats symptomatic hypoglycemia at once." },
      { label: "B", rationale: "More insulin would drive the blood glucose lower." },
      { label: "C", rationale: "Hypoglycemia is treated under protocol before the provider is called." },
    ],
    teachingPoint: "Treat symptomatic hypoglycemia first, then look for the cause.",
    concern: "",
    ...overrides,
  };
}

const ctx = (fetch: typeof globalThis.fetch) => ({
  apiKey: "sk-ant-test",
  model: "claude-opus-5",
  fetch,
  baseURL: BASE_URL,
});

describe("enrichQuestions", () => {
  it("fills in the missing fields and clears the review flag", async () => {
    const api = fakeApi([textResponse(JSON.stringify({ items: [answer()] }), { usage: { input_tokens: 900, output_tokens: 300 } })]);
    const result = await enrichQuestions([imported()], ctx(api.fetch));

    assert.equal(result.questions.length, 1);
    const [updated] = result.questions as [Question];
    assert.equal(updated.category, "pharmacological_and_parenteral_therapies");
    assert.equal(updated.subtopic, "Adverse Effects/Contraindications/Side Effects/Interactions");
    assert.equal(updated.clinicalJudgmentStep, "take_action");
    assert.equal(updated.teachingPoint, "Treat symptomatic hypoglycemia first, then look for the cause.");
    assert.ok(updated.options.every((o) => o.rationale !== PLACEHOLDER_RATIONALE));
    assert.equal(updated.needsReview, undefined, "nothing is missing any more");
    assert.deepEqual(result.flagged, []);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.usage, { inputTokens: 900, outputTokens: 300 });
  });

  it("never lets the model change the question, its options or the keyed answer", async () => {
    const api = fakeApi([
      textResponse(
        JSON.stringify({
          items: [
            {
              ...answer(),
              // A model that tried to rewrite the item and re-key it:
              stem: "A completely different question.",
              options: [{ label: "A", text: "Rewritten option" }],
              correct: "C",
            },
          ],
        }),
      ),
    ]);
    const original = imported();
    const result = await enrichQuestions([original], ctx(api.fetch));
    const [updated] = result.questions as [Question];
    assert.equal(updated.stem, original.stem);
    assert.equal(updated.correct, "A");
    assert.deepEqual(updated.options.map((o) => o.text), original.options.map((o) => o.text));
    assert.equal(updated.id, original.id);
    assert.equal(updated.source, "imported");
  });

  it("keeps a rationale the author already wrote", async () => {
    const original = imported({
      options: [
        { label: "A", text: "Give 15 grams of a fast-acting carbohydrate.", rationale: "The author's own rationale." },
        { label: "B", text: "Administer the scheduled long-acting insulin.", rationale: PLACEHOLDER_RATIONALE },
        { label: "C", text: "Notify the provider and wait for orders.", rationale: PLACEHOLDER_RATIONALE },
      ],
    });
    const api = fakeApi([textResponse(JSON.stringify({ items: [answer()] }))]);
    const result = await enrichQuestions([original], ctx(api.fetch));
    const [updated] = result.questions as [Question];
    assert.equal(updated.options[0]?.rationale, "The author's own rationale.");
    assert.ok(updated.options[1]?.rationale.startsWith("More insulin"));
  });

  it("leaves a question untouched when Claude raises a concern", async () => {
    const api = fakeApi([
      textResponse(JSON.stringify({ items: [answer({ concern: "Option C is defensible: the protocol may require a provider call." })] })),
    ]);
    const result = await enrichQuestions([imported()], ctx(api.fetch));
    assert.deepEqual(result.questions, [], "nothing is saved for a flagged question");
    assert.deepEqual(result.flagged, [
      { id: "imported-1", concern: "Option C is defensible: the protocol may require a provider call." },
    ]);
  });

  it("sends the right request: blueprint, cache breakpoint, fallbacks and structured output", async () => {
    const api = fakeApi([textResponse(JSON.stringify({ items: [answer()] }))]);
    await enrichQuestions([imported()], ctx(api.fetch));

    const [request] = api.requests;
    assert.ok(request);
    assert.equal(request.method, "POST");
    assert.equal(request.url, `${BASE_URL}/v1/messages?beta=true`);
    assert.ok(request.headers["anthropic-beta"]?.includes("server-side-fallback-2026-07-01"));
    const body = request.body as Record<string, unknown>;
    assert.equal(body.fallbacks, "default");
    assert.deepEqual(body.thinking, { type: "adaptive" });
    const output = body.output_config as { effort: string; format: { type: string } };
    assert.equal(output.effort, "medium");
    assert.equal(output.format.type, "json_schema");
    const system = body.system as { text: string; cache_control?: unknown }[];
    assert.ok(system.some((block) => block.text.includes("Management of Care")), "the blueprint is in the system prompt");
    assert.ok(system.some((block) => block.cache_control), "the stable block carries a cache breakpoint");
    const user = JSON.stringify(body.messages);
    assert.ok(user.includes("Keyed correct answer: A"));
    assert.ok(user.includes("imported-1"));
  });

  it("splits large sets into batches", async () => {
    const questions = Array.from({ length: ENRICH_BATCH_SIZE * 2 + 5 }, (_, i) => imported({ id: `imported-${i}` }));
    const api = fakeApi([]);
    for (let start = 0; start < questions.length; start += ENRICH_BATCH_SIZE) {
      const batch = questions.slice(start, start + ENRICH_BATCH_SIZE);
      api.push(textResponse(JSON.stringify({ items: batch.map((q) => answer({ id: q.id })) })));
    }
    const result = await enrichQuestions(questions, ctx(api.fetch));
    assert.equal(api.requests.length, 3);
    assert.equal(result.questions.length, questions.length);
  });

  it("reports a refusal or an unreadable answer as a warning instead of failing", async () => {
    const refusal = fakeApi([
      textResponse("", { stop_reason: "refusal", stop_details: { type: "refusal", category: "bio", explanation: "declined" } }),
    ]);
    const refused = await enrichQuestions([imported()], ctx(refusal.fetch));
    assert.deepEqual(refused.questions, []);
    assert.equal(refused.warnings.length, 1);
    assert.ok(refused.warnings[0]?.includes("declined"));

    const garbled = fakeApi([textResponse("not json at all")]);
    const unreadable = await enrichQuestions([imported()], ctx(garbled.fetch));
    assert.deepEqual(unreadable.questions, []);
    assert.ok(unreadable.warnings[0]?.includes("left unchanged"));
  });

  it("maps API errors to a GeneratorError the browser can act on", async () => {
    const api = fakeApi([errorResponse(401, "authentication_error", "invalid x-api-key")]);
    await assert.rejects(
      () => enrichQuestions([imported()], ctx(api.fetch)),
      (err: Error & { status?: number; code?: string }) => {
        assert.equal(err.name, "GeneratorError");
        assert.equal(err.status, 401);
        assert.equal(err.code, "invalid_api_key");
        return true;
      },
    );
  });

  it("does nothing, and calls nothing, for an empty list", async () => {
    const api = fakeApi([]);
    const result = await enrichQuestions([], ctx(api.fetch));
    assert.deepEqual(result.questions, []);
    assert.equal(api.requests.length, 0);
  });
});
