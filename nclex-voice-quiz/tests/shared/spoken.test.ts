import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFeedbackScript, buildQuestionScript, parseSpokenCommand } from "../../src/shared/spoken.js";
import type { Question } from "../../src/shared/types.js";

const question: Question = {
  id: "moc-001",
  stem: "A nurse receives handoff report on three clients. Which client should the nurse assess first",
  options: [
    { label: "A", text: "The client with heart failure.", rationale: "Fluid retention is gradual." },
    { label: "B", text: "The client with COPD who is newly confused", rationale: "New confusion with hypoxemia is acute." },
    { label: "C", text: "The client with postoperative pain.", rationale: "Pain is expected and not life threatening." },
  ],
  correct: "B",
  category: "management_of_care",
  subtopic: "Establishing Priorities",
  difficulty: "medium",
  source: "bundled",
  createdAt: "2026-09-10T00:00:00Z",
};

function answer(label: "A" | "B" | "C") {
  return { kind: "answer", label };
}

describe("parseSpokenCommand letters", () => {
  const cases: [string, "A" | "B" | "C"][] = [
    ["a", "A"],
    ["A", "A"],
    ["b", "B"],
    ["bee", "B"],
    ["be", "B"],
    ["b.", "B"],
    ["B.", "B"],
    ["c", "C"],
    ["see", "C"],
    ["sea", "C"],
    ["cee", "C"],
    ["C", "C"],
  ];
  for (const [input, label] of cases) {
    it(`"${input}" -> ${label}`, () => {
      assert.deepEqual(parseSpokenCommand([input]), answer(label));
    });
  }
});

describe("parseSpokenCommand NATO, ordinals and numbers", () => {
  const cases: [string, "A" | "B" | "C"][] = [
    ["alpha", "A"],
    ["bravo", "B"],
    ["charlie", "C"],
    ["Charlie", "C"],
    ["first", "A"],
    ["second", "B"],
    ["third", "C"],
    ["one", "A"],
    ["two", "B"],
    ["three", "C"],
    ["1", "A"],
    ["2", "B"],
    ["3", "C"],
  ];
  for (const [input, label] of cases) {
    it(`"${input}" -> ${label}`, () => {
      assert.deepEqual(parseSpokenCommand([input]), answer(label));
    });
  }
});

describe("parseSpokenCommand phrases", () => {
  const cases: [string, "A" | "B" | "C"][] = [
    ["option b", "B"],
    ["Option B.", "B"],
    ["answer c", "C"],
    ["the second one", "B"],
    ["the first one", "A"],
    ["the third one", "C"],
    ["i think it's a", "A"],
    ["I think it's A.", "A"],
    ["letter c", "C"],
    ["number two", "B"],
    ["the answer is bravo", "B"],
    ["it should be c", "C"],
    ["I'll go with option a", "A"],
  ];
  for (const [input, label] of cases) {
    it(`"${input}" -> ${label}`, () => {
      assert.deepEqual(parseSpokenCommand([input]), answer(label));
    });
  }

  it("prefers an explicit option phrase over a stray letter", () => {
    assert.deepEqual(parseSpokenCommand(["a option c"]), answer("C"));
    assert.deepEqual(parseSpokenCommand(["i think a answer b"]), answer("B"));
  });
});

describe("parseSpokenCommand commands", () => {
  const cases: [string, string][] = [
    ["repeat", "repeat"],
    ["Repeat the question", "repeat"],
    ["say again", "repeat"],
    ["say that again", "repeat"],
    ["next", "next"],
    ["next question", "next"],
    ["skip", "skip"],
    ["skip this one", "skip"],
    ["stop", "stop"],
    ["stop the quiz", "stop"],
  ];
  for (const [input, kind] of cases) {
    it(`"${input}" -> ${kind}`, () => {
      assert.deepEqual(parseSpokenCommand([input]), { kind });
    });
  }
});

describe("parseSpokenCommand ambiguity and no match", () => {
  it("returns null when two different labels are named", () => {
    assert.equal(parseSpokenCommand(["a or b"]), null);
    assert.equal(parseSpokenCommand(["option a or option c"]), null);
    assert.equal(parseSpokenCommand(["bravo charlie"]), null);
  });

  it("accepts the same label named twice", () => {
    assert.deepEqual(parseSpokenCommand(["b bee"]), answer("B"));
  });

  it("returns null for empty input", () => {
    assert.equal(parseSpokenCommand([]), null);
    assert.equal(parseSpokenCommand([""]), null);
    assert.equal(parseSpokenCommand(["   "]), null);
  });

  it("returns null when nothing matches", () => {
    assert.equal(parseSpokenCommand(["hello there"]), null);
    assert.equal(parseSpokenCommand(["d"]), null);
    assert.equal(parseSpokenCommand(["option d"]), null);
    assert.equal(parseSpokenCommand(["the nurse should"]), null);
  });

  it("uses the first alternative that gives a definite answer", () => {
    assert.deepEqual(parseSpokenCommand(["hmm", "bee"]), answer("B"));
    assert.deepEqual(parseSpokenCommand(["a or b", "a"]), answer("A"));
    assert.deepEqual(parseSpokenCommand(["c", "see"]), answer("C"));
  });
});

describe("buildQuestionScript", () => {
  it("numbers the question and reads the stem and all three options", () => {
    const script = buildQuestionScript(question, 1, 5);
    assert.deepEqual(script, [
      "Question 2 of 5.",
      "A nurse receives handoff report on three clients. Which client should the nurse assess first.",
      "Option A: The client with heart failure.",
      "Option B: The client with COPD who is newly confused.",
      "Option C: The client with postoperative pain.",
    ]);
  });

  it("does not double punctuation that already ends a sentence", () => {
    const q: Question = { ...question, stem: "Which action is the priority?" };
    assert.equal(buildQuestionScript(q, 0, 1)[1], "Which action is the priority?");
  });
});

describe("buildFeedbackScript", () => {
  it("speaks Correct plus the rationale of the correct option", () => {
    assert.deepEqual(buildFeedbackScript(question, "B", true), [
      "Correct.",
      "New confusion with hypoxemia is acute.",
    ]);
  });

  it("speaks Wrong, the chosen rationale, the correct answer and its rationale", () => {
    assert.deepEqual(buildFeedbackScript(question, "A", true), [
      "Wrong.",
      "Fluid retention is gradual.",
      "The correct answer is B, The client with COPD who is newly confused.",
      "New confusion with hypoxemia is acute.",
    ]);
  });

  it("strips the option's trailing full stop when naming the correct answer", () => {
    const q: Question = { ...question, correct: "A" };
    const script = buildFeedbackScript(q, "C", true);
    assert.equal(script[2], "The correct answer is A, The client with heart failure.");
  });

  it("shortens to the verdict when readRationale is false", () => {
    assert.deepEqual(buildFeedbackScript(question, "B", false), ["Correct."]);
    assert.deepEqual(buildFeedbackScript(question, "C", false), [
      "Wrong.",
      "The correct answer is B, The client with COPD who is newly confused.",
    ]);
  });
});
