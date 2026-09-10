import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateQuestion } from "../../src/server/questions/validate.js";

function valid(): Record<string, unknown> {
  return {
    id: "imp-1",
    stem: "  A client receiving IV potassium chloride reports burning at the infusion site. What should the nurse do first?  ",
    options: [
      { label: "A", text: " Slow the infusion rate and assess the site ", rationale: " Burning is common with peripheral potassium; slowing the rate and checking for infiltration is the first step. " },
      { label: "B", text: "Stop the infusion and remove the IV", rationale: "Removal is needed only when infiltration or phlebitis is confirmed." },
      { label: "C", text: "Administer the potassium by IV push instead", rationale: "Potassium is never given by IV push because it can cause fatal dysrhythmias." },
    ],
    correct: "A",
    category: "pharmacological_and_parenteral_therapies",
    subtopic: "Parenteral/Intravenous Therapies",
    clinicalJudgmentStep: "take_action",
    difficulty: "medium",
    source: "imported",
    teachingPoint: "Peripheral potassium infusions burn; slow the rate, never push it.",
    references: ["Lippincott IV therapy guide", " "],
    tags: ["potassium"],
    createdAt: "2026-02-01T10:00:00.000Z",
    extraField: "ignored",
  };
}

function errorsFor(input: unknown): string[] {
  const result = validateQuestion(input);
  return result.ok ? [] : result.errors;
}

describe("validateQuestion", () => {
  it("accepts a valid question, trims strings and drops unknown fields", () => {
    const result = validateQuestion(valid());
    assert.ok(result.ok);
    const q = result.question;
    assert.equal(q.stem, "A client receiving IV potassium chloride reports burning at the infusion site. What should the nurse do first?");
    assert.equal(q.options[0]?.text, "Slow the infusion rate and assess the site");
    assert.equal(q.options[0]?.rationale.startsWith("Burning is common"), true);
    assert.deepEqual(q.references, ["Lippincott IV therapy guide"]);
    assert.equal(q.clinicalJudgmentStep, "take_action");
    assert.equal("extraField" in q, false);
    assert.equal(q.createdAt, "2026-02-01T10:00:00.000Z");
  });

  it("rejects non-objects", () => {
    assert.deepEqual(errorsFor(null), ["question must be an object"]);
    assert.deepEqual(errorsFor("text"), ["question must be an object"]);
    assert.deepEqual(errorsFor([]), ["question must be an object"]);
  });

  it("requires a plain-text stem of at least 20 characters", () => {
    assert.ok(errorsFor({ ...valid(), stem: "" }).some((e) => e.includes("stem is required")));
    assert.ok(errorsFor({ ...valid(), stem: 42 }).some((e) => e.includes("stem is required")));
    assert.ok(errorsFor({ ...valid(), stem: "Too short?" }).some((e) => e.includes("at least 20")));
    assert.ok(errorsFor({ ...valid(), stem: "Which **bold** option is the best answer here?" }).some((e) => e.includes("plain text")));
  });

  it("requires exactly three options labelled A, B, C in order", () => {
    const q = valid();
    const options = q.options as Record<string, unknown>[];
    assert.ok(errorsFor({ ...q, options: options.slice(0, 2) }).some((e) => e.includes("exactly 3 options")));
    assert.ok(errorsFor({ ...q, options: [...options, { label: "D", text: "x", rationale: "y" }] }).some((e) => e.includes("exactly 3 options")));
    assert.ok(errorsFor({ ...q, options: "abc" }).some((e) => e.includes("exactly 3 options")));
    const swapped = [options[1], options[0], options[2]];
    const errs = errorsFor({ ...q, options: swapped });
    assert.ok(errs.some((e) => e.includes('option 1 must have label "A"')));
    assert.ok(errs.some((e) => e.includes('option 2 must have label "B"')));
    assert.ok(errorsFor({ ...q, options: [options[0], "B", options[2]] }).some((e) => e.includes("option B must be an object")));
  });

  it("requires non-empty option text and rationale", () => {
    const q = valid();
    const options = q.options as Record<string, unknown>[];
    const noText = [{ ...options[0], text: "   " }, options[1], options[2]];
    assert.ok(errorsFor({ ...q, options: noText }).some((e) => e === "option A text is required"));
    const noRationale = [options[0], { ...options[1], rationale: undefined }, options[2]];
    assert.ok(errorsFor({ ...q, options: noRationale }).some((e) => e === "option B rationale is required"));
  });

  it("rejects duplicate option texts case-insensitively", () => {
    const q = valid();
    const options = q.options as Record<string, unknown>[];
    const dup = [options[0], options[1], { ...options[2], text: " SLOW the infusion rate and assess the site" }];
    assert.ok(errorsFor({ ...q, options: dup }).some((e) => e.includes("option C text duplicates")));
  });

  it("requires correct to be one of the labels", () => {
    assert.ok(errorsFor({ ...valid(), correct: "D" }).some((e) => e.includes("correct must be")));
    assert.ok(errorsFor({ ...valid(), correct: undefined }).some((e) => e.includes("correct must be")));
    assert.ok(errorsFor({ ...valid(), correct: "a" }).some((e) => e.includes("correct must be")));
  });

  it("rejects unknown enum values", () => {
    assert.ok(errorsFor({ ...valid(), category: "cardiology" }).some((e) => e.includes("category")));
    assert.ok(errorsFor({ ...valid(), difficulty: "brutal" }).some((e) => e.includes("difficulty")));
    assert.ok(errorsFor({ ...valid(), clinicalJudgmentStep: "guess" }).some((e) => e.includes("clinicalJudgmentStep")));
    assert.ok(errorsFor({ ...valid(), source: "web" }).some((e) => e.includes("source")));
  });

  it("treats a missing or null clinicalJudgmentStep as absent", () => {
    const withoutStep = validateQuestion({ ...valid(), clinicalJudgmentStep: null });
    assert.ok(withoutStep.ok);
    assert.equal("clinicalJudgmentStep" in withoutStep.question, false);
  });

  it("requires a subtopic", () => {
    assert.ok(errorsFor({ ...valid(), subtopic: "  " }).some((e) => e === "subtopic is required"));
    assert.ok(errorsFor({ ...valid(), subtopic: undefined }).some((e) => e === "subtopic is required"));
  });

  it("fills in source, id and createdAt when they are missing", () => {
    const input = valid();
    delete input.id;
    delete input.source;
    delete input.createdAt;
    const result = validateQuestion(input, { defaultSource: "ai", defaultId: "ai-x", now: () => new Date("2026-03-01T00:00:00Z") });
    assert.ok(result.ok);
    assert.equal(result.question.source, "ai");
    assert.equal(result.question.id, "ai-x");
    assert.equal(result.question.createdAt, "2026-03-01T00:00:00.000Z");
    const plain = validateQuestion(input);
    assert.ok(plain.ok);
    assert.equal(plain.question.source, "imported");
    assert.equal(plain.question.id, "");
  });

  it("rejects malformed optional fields", () => {
    assert.ok(errorsFor({ ...valid(), createdAt: "yesterday" }).some((e) => e.includes("createdAt")));
    assert.ok(errorsFor({ ...valid(), references: "a book" }).some((e) => e.includes("references")));
    assert.ok(errorsFor({ ...valid(), tags: [1, 2] }).some((e) => e.includes("tags")));
    assert.ok(errorsFor({ ...valid(), teachingPoint: { text: "x" } }).some((e) => e.includes("teachingPoint")));
    assert.ok(errorsFor({ ...valid(), id: 12 }).some((e) => e.includes("id must be a string")));
  });

  it("collects every error at once", () => {
    const errs = errorsFor({ stem: "short", options: [], correct: "Z", category: "x", difficulty: "y" });
    assert.ok(errs.length >= 5, errs.join("; "));
  });
});
