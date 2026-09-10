import { test } from "node:test";
import assert from "node:assert/strict";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { BatchSchema, normaliseStem, parseBatchText, toQuestions } from "../../src/server/generator/schema.js";
import { generatedQuestion } from "./fake-api.js";

const NOW = new Date("2026-09-10T12:00:00.000Z");

test("BatchSchema converts to a strict JSON schema the API accepts", () => {
  const format = betaZodOutputFormat(BatchSchema);
  assert.equal(format.type, "json_schema");
  const schema = format.schema as { type: string; properties: Record<string, unknown>; additionalProperties: boolean };
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.ok("questions" in schema.properties);
  // The SDK folds enum lists into the description text; the ids must still reach the model.
  const json = JSON.stringify(schema);
  assert.ok(json.includes("management_of_care"));
  assert.ok(json.includes("recognize_cues"));
});

test("parseBatchText returns null for non-JSON or the wrong shape", () => {
  assert.equal(parseBatchText("not json"), null);
  assert.equal(parseBatchText('{"questions": "nope"}'), null);
  assert.equal(parseBatchText("[]"), null);
  assert.deepEqual(parseBatchText('{"questions": [1]}'), { questions: [1] });
});

test("normaliseStem ignores case and whitespace", () => {
  assert.equal(normaliseStem("  A  Nurse\n is  here "), "a nurse is here");
});

test("toQuestions builds Question objects with ids, timestamps and source ai", () => {
  const entries = [generatedQuestion(), generatedQuestion({ correct: "C" })];
  const { questions, warnings } = toQuestions(entries, { now: NOW });
  assert.deepEqual(warnings, []);
  assert.equal(questions.length, 2);
  assert.equal(questions[0]!.id, `ai-${NOW.getTime()}-0`);
  assert.equal(questions[1]!.id, `ai-${NOW.getTime()}-1`);
  for (const q of questions) {
    assert.equal(q.source, "ai");
    assert.equal(q.createdAt, NOW.toISOString());
    assert.equal(q.options.length, 3);
    assert.deepEqual(q.options.map((o) => o.label), ["A", "B", "C"]);
  }
  assert.equal(questions[1]!.correct, "C");
});

test("toQuestions drops invalid entries with one warning each and keeps the rest", () => {
  const good = generatedQuestion();
  const entries = [
    good,
    generatedQuestion({ options: (generatedQuestion().options as unknown[]).slice(0, 2) }),
    generatedQuestion({ correct: "D" }),
    generatedQuestion({ category: "not_a_category" }),
    generatedQuestion({ difficulty: "brutal" }),
    generatedQuestion({ clinicalJudgmentStep: "guess" }),
    generatedQuestion({ stem: "   " }),
    generatedQuestion({ teachingPoint: "" }),
    "garbage",
  ];
  const { questions, warnings } = toQuestions(entries, { now: NOW });
  assert.equal(questions.length, 1);
  assert.equal(questions[0]!.stem, good.stem);
  assert.equal(warnings.length, 8);
  assert.ok(warnings.every((w) => w.includes("was dropped")));
  assert.ok(warnings.some((w) => w.includes("expected 3 options")));
});

test("toQuestions tolerates missing references/tags and reorders nothing", () => {
  const entry = generatedQuestion();
  delete (entry as Record<string, unknown>).references;
  delete (entry as Record<string, unknown>).tags;
  const { questions, warnings } = toQuestions([entry], { now: NOW });
  assert.deepEqual(warnings, []);
  assert.deepEqual(questions[0]!.references, []);
  assert.deepEqual(questions[0]!.tags, []);
});

test("toQuestions dedupes against existing stems and within the batch", () => {
  const stem = "A nurse is assessing a client with a new tracheostomy who suddenly becomes restless. Which action should the nurse take first?";
  const entries = [
    generatedQuestion({ stem }),
    generatedQuestion({ stem: `  ${stem.toUpperCase()}  ` }),
    generatedQuestion({ stem: "An existing   question about    delegation of tasks. Which task is appropriate?" }),
  ];
  const { questions, warnings } = toQuestions(entries, {
    now: NOW,
    existingStems: ["an existing question about delegation of tasks. which task is appropriate?"],
  });
  assert.equal(questions.length, 1);
  assert.equal(questions[0]!.stem, stem);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((w) => w.includes("duplicate")));
});

test("toQuestions warns but keeps a question whose subtopic is not an activity statement", () => {
  const { questions, warnings } = toQuestions([generatedQuestion({ subtopic: "Made up topic" })], { now: NOW });
  assert.equal(questions.length, 1);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0]!.includes("kept anyway"));
});
