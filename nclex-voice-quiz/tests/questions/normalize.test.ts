/** The importer's repair rules: what it accepts, what it fixes, and what it refuses. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyQuestion } from "../../src/server/questions/classify.js";
import {
  extractQuestionList,
  normalizeQuestion,
  PLACEHOLDER_RATIONALE,
  PLACEHOLDER_SUBTOPIC,
  stemKey,
  toPlainText,
} from "../../src/server/questions/normalize.js";
import { validateQuestion } from "../../src/server/questions/validate.js";

const STEM = "A nurse is caring for a client who received regular insulin 30 minutes ago and is now sweating and confused. Which action should the nurse take first?";

/** The shape ChatGPT produces when it is not given a strict schema. */
function chatGptStyle(): Record<string, unknown> {
  return {
    question: STEM,
    options: [
      "Give 15 grams of a fast-acting carbohydrate.",
      "Administer the scheduled long-acting insulin.",
      "Notify the provider and wait for orders.",
    ],
    answer: "A",
    explanation: "Treat symptomatic hypoglycemia before looking for the cause.",
  };
}

describe("extractQuestionList", () => {
  it("accepts a bare array, { questions } and { version, questions }", () => {
    assert.deepEqual(extractQuestionList([1, 2]), { list: [1, 2] });
    assert.deepEqual(extractQuestionList({ questions: [1] }), { list: [1] });
    assert.deepEqual(extractQuestionList({ version: 1, questions: [] }), { list: [] });
    assert.deepEqual(extractQuestionList({ items: [1] }), { list: [1] });
  });

  it("explains itself when the shape is unusable", () => {
    const result = extractQuestionList({ foo: 1 });
    assert.ok("error" in result && result.error.includes("questions"));
  });
});

describe("normalizeQuestion", () => {
  it("repairs a ChatGPT-style entry into a valid question", () => {
    const normalized = normalizeQuestion(chatGptStyle());
    assert.deepEqual(normalized.errors, []);
    const value = normalized.value;
    assert.ok(value);
    const checked = validateQuestion(value, { defaultSource: "imported" });
    assert.ok(checked.ok, checked.ok ? "" : checked.errors.join("; "));
    const question = checked.ok ? checked.question : null;
    assert.ok(question);
    assert.equal(question.correct, "A");
    assert.deepEqual(question.options.map((o) => o.label), ["A", "B", "C"]);
    assert.equal(question.options[0]?.text, "Give 15 grams of a fast-acting carbohydrate.");
    assert.equal(question.teachingPoint, "Treat symptomatic hypoglycemia before looking for the cause.");
    assert.equal(question.difficulty, "medium", "difficulty defaults to medium");
  });

  it("flags the gaps it had to fill, and only the substantive ones", () => {
    const normalized = normalizeQuestion(chatGptStyle());
    assert.equal(normalized.needsReview, true);
    assert.ok(normalized.gaps.some((g) => g.includes("category")));
    assert.ok(normalized.gaps.some((g) => g.includes("rationale for option A")));
    assert.equal(normalized.value?.needsReview, true);
    assert.equal((normalized.value?.options as { rationale: string }[])[0]?.rationale, PLACEHOLDER_RATIONALE);
    assert.equal(normalized.value?.subtopic, PLACEHOLDER_SUBTOPIC);

    // Everything substantive present, only a teaching point missing: not worth flagging.
    const complete = normalizeQuestion({
      ...chatGptStyle(),
      explanation: undefined,
      category: "pharmacological_and_parenteral_therapies",
      subtopic: "Medication Administration",
      rationales: { A: "Fast-acting carbohydrate raises the glucose quickly.", B: "More insulin lowers it further.", C: "Waiting delays emergency care." },
    });
    assert.equal(complete.needsReview, false);
    assert.equal(complete.value?.needsReview, undefined);
    assert.ok(complete.gaps.some((g) => g.includes("teaching point")));
  });

  it("guesses a category from the wording and keeps a valid one", () => {
    const guessed = normalizeQuestion(chatGptStyle());
    assert.equal(guessed.value?.category, classifyQuestion(STEM, []).category);
    const given = normalizeQuestion({ ...chatGptStyle(), category: "Basic Care and Comfort" });
    assert.equal(given.value?.category, "basic_care_and_comfort", "a human-written category name is normalised");
    const exact = normalizeQuestion({ ...chatGptStyle(), category: "psychosocial_integrity" });
    assert.equal(exact.value?.category, "psychosocial_integrity");
  });

  it("reads the answer as a label, an index or the option's own text", () => {
    const cases: [unknown, string][] = [
      ["B", "B"],
      ["b.", "B"],
      ["Option C)", "C"],
      ["answer: b", "B"],
      [0, "A"],
      [2, "B"],
      [3, "C"],
      ["3", "C"],
      ["Administer the scheduled long-acting insulin.", "B"],
    ];
    for (const [answer, expected] of cases) {
      const normalized = normalizeQuestion({ ...chatGptStyle(), answer });
      assert.equal(normalized.value?.correct, expected, `answer ${JSON.stringify(answer)}`);
    }
  });

  it("keeps the label the writer put on each option", () => {
    const normalized = normalizeQuestion({
      question: STEM,
      choices: { B: "Second option text here.", A: "First option text here.", C: "Third option text here." },
      key: "A",
    });
    // Written order is preserved, so "A" means the option the writer labelled A.
    const options = normalized.value?.options as { label: string; text: string }[];
    assert.equal(options[0]?.text, "Second option text here.");
    assert.equal(normalized.value?.correct, "B", "the option labelled A moved to position B and the key followed it");
  });

  it("attaches rationales given separately, as a map or a list", () => {
    const byMap = normalizeQuestion({ ...chatGptStyle(), rationales: { A: "Right because.", B: "Wrong because.", C: "Also wrong." } });
    assert.equal((byMap.value?.options as { rationale: string }[])[1]?.rationale, "Wrong because.");
    const byList = normalizeQuestion({ ...chatGptStyle(), explanations: ["Right.", "Wrong.", "Wrong too."] });
    assert.equal((byList.value?.options as { rationale: string }[])[2]?.rationale, "Wrong too.");
  });

  it("trims a four-option question to the correct answer plus the first two distractors", () => {
    const normalized = normalizeQuestion({
      question: STEM,
      options: ["First distractor.", "Second distractor.", "Third distractor.", "The correct action."],
      answer: "D",
    });
    const options = normalized.value?.options as { label: string; text: string }[];
    assert.equal(options.length, 3);
    assert.deepEqual(options.map((o) => o.text), ["First distractor.", "Second distractor.", "The correct action."]);
    assert.equal(normalized.value?.correct, "C");
    assert.deepEqual(normalized.droppedOptions, ["Third distractor."]);
  });

  it("strips markdown so the stem passes validation and reads aloud", () => {
    const normalized = normalizeQuestion({ ...chatGptStyle(), question: `**${STEM}**` });
    assert.equal(normalized.value?.stem, STEM);
    assert.ok(validateQuestion(normalized.value, { defaultSource: "imported" }).ok);
  });

  it("rejects only what cannot be recovered", () => {
    assert.deepEqual(normalizeQuestion("nope").errors, ["not an object"]);
    assert.ok(normalizeQuestion({ options: ["a", "b", "c"], answer: "A" }).errors[0]?.includes("no question text"));
    assert.ok(normalizeQuestion({ question: STEM, options: ["a", "b"], answer: "A" }).errors[0]?.includes("at least 3 options"));
    assert.ok(normalizeQuestion({ question: STEM, options: ["a", "b", "c"], answer: "Z" }).errors[0]?.includes("which option is correct"));
    assert.ok(normalizeQuestion({ question: STEM, options: ["a", "b", "c"] }).errors[0]?.includes("which option is correct"));
  });
});

describe("stemKey and toPlainText", () => {
  it("ignores case, spacing and punctuation when spotting the same question twice", () => {
    assert.equal(stemKey("Which action   should the nurse take FIRST?"), stemKey("which action should the nurse take first"));
    assert.notEqual(stemKey("Which action should the nurse take first?"), stemKey("Which action should the nurse take next?"));
  });

  it("removes markdown markers and collapses whitespace", () => {
    assert.equal(toPlainText("**bold**  and\n`code`"), "bold and code");
    assert.equal(toPlainText(42), "");
  });
});

describe("classifyQuestion", () => {
  it("picks the category the wording points at", () => {
    assert.equal(classifyQuestion("Which client should the nurse see first when delegating to an unlicensed assistive person?").category, "management_of_care");
    assert.equal(classifyQuestion("Which personal protective equipment does the nurse wear for droplet precautions?").category, "safety_and_infection_control");
    assert.equal(classifyQuestion("The nurse reviews the potassium level before giving the medication dose.").category, "pharmacological_and_parenteral_therapies");
    assert.equal(classifyQuestion("Which response by the nurse is most therapeutic for a grieving client?").category, "psychosocial_integrity");
  });

  it("reports a zero score when nothing matched", () => {
    const result = classifyQuestion("The quick brown fox jumps over the lazy dog.");
    assert.equal(result.score, 0);
    assert.equal(result.matched.length, 0);
  });
});
