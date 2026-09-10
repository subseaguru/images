/**
 * Spoken-language helpers shared by the browser (to build what is read aloud and to interpret the
 * learner's spoken answers) and the server tests. Must stay free of DOM and Node APIs.
 */
import type { OptionLabel, Question } from "./types.js";
import { OPTION_LABELS } from "./types.js";

export type SpokenCommand =
  | { kind: "answer"; label: OptionLabel }
  | { kind: "repeat" | "next" | "skip" | "stop" };

/** Ensure a chunk reads as a full sentence so consecutive utterances do not run together. */
function sentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed === "") return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Text without its trailing full stop, for embedding inside another sentence. */
function clause(text: string): string {
  return text.trim().replace(/[.]+$/, "");
}

/** "Question 2 of 5." followed by the stem and each option, one chunk per utterance. */
export function buildQuestionScript(question: Question, index: number, total: number): string[] {
  const chunks = [`Question ${index + 1} of ${total}.`, sentence(question.stem)];
  for (const option of question.options) {
    chunks.push(`Option ${option.label}: ${sentence(option.text)}`);
  }
  return chunks;
}

/**
 * Feedback wording:
 *  - correct: "Correct." + rationale of the correct option
 *  - wrong:   "Wrong." + rationale of the chosen option + "The correct answer is B, <text>." +
 *             rationale of the correct option
 * With `readRationale` false only the verdict (and, when wrong, the correct answer) is spoken.
 */
export function buildFeedbackScript(question: Question, chosen: OptionLabel, readRationale: boolean): string[] {
  const correctOption = question.options.find((o) => o.label === question.correct);
  const chosenOption = question.options.find((o) => o.label === chosen);
  if (chosen === question.correct) {
    const chunks = ["Correct."];
    if (readRationale && correctOption) chunks.push(sentence(correctOption.rationale));
    return chunks;
  }
  const chunks = ["Wrong."];
  if (readRationale && chosenOption) chunks.push(sentence(chosenOption.rationale));
  if (correctOption) chunks.push(`The correct answer is ${correctOption.label}, ${clause(correctOption.text)}.`);
  if (readRationale && correctOption) chunks.push(sentence(correctOption.rationale));
  return chunks;
}

// ---------------------------------------------------------------------------------------------
// Spoken answer parsing
// ---------------------------------------------------------------------------------------------

/** Words that clearly name an option even on their own. */
const STRONG_WORDS: Record<string, OptionLabel> = {
  a: "A",
  alpha: "A",
  alfa: "A",
  first: "A",
  one: "A",
  "1": "A",
  "1st": "A",
  b: "B",
  bee: "B",
  bravo: "B",
  second: "B",
  two: "B",
  "2": "B",
  "2nd": "B",
  c: "C",
  cee: "C",
  sea: "C",
  charlie: "C",
  third: "C",
  three: "C",
  "3": "C",
  "3rd": "C",
};

/**
 * Homophones that are also ordinary English words ("it should be c"). They only count when the
 * transcript contains nothing stronger, so "be" alone still means B.
 */
const WEAK_WORDS: Record<string, OptionLabel> = {
  be: "B",
  see: "C",
  si: "C",
  too: "B",
  to: "B",
  tree: "C",
};

const COMMANDS: { kind: "repeat" | "next" | "skip" | "stop"; patterns: RegExp[] }[] = [
  {
    kind: "repeat",
    patterns: [/\brepeat\b/, /\bsay (?:that |it )?again\b/, /\bread (?:that |it )?again\b/, /\bagain\b/, /\bone more time\b/],
  },
  { kind: "next", patterns: [/\bnext\b/, /\bcontinue\b/, /\bgo on\b/, /\bmove on\b/] },
  { kind: "skip", patterns: [/\bskip\b/, /\bpass\b/] },
  { kind: "stop", patterns: [/\bstop\b/, /\bquit\b/, /\bend (?:the )?quiz\b/, /\bfinish\b/, /\bexit\b/] },
];

/** Phrases that explicitly name an option; the captured word is mapped through the word tables. */
const EXPLICIT_PATTERNS: RegExp[] = [
  /\b(?:option|answer|letter|choice|number|choose|select|pick|go with)\s+(\S+)/g,
  /\b(first|second|third|1st|2nd|3rd|one|two|three|1|2|3)\s+(?:one|option|answer|choice)\b/g,
];

function normalize(transcript: string): string {
  return transcript
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function labelFor(word: string): OptionLabel | undefined {
  return STRONG_WORDS[word] ?? WEAK_WORDS[word];
}

function single(labels: Set<OptionLabel>): OptionLabel | null {
  if (labels.size !== 1) return null;
  const [label] = labels;
  return label ?? null;
}

function parseOne(text: string): SpokenCommand | null | "ambiguous" {
  if (text === "") return null;
  for (const command of COMMANDS) {
    if (command.patterns.some((p) => p.test(text))) return { kind: command.kind };
  }

  const explicit = new Set<OptionLabel>();
  for (const pattern of EXPLICIT_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const label = labelFor(match[1] ?? "");
      if (label) explicit.add(label);
    }
  }
  if (explicit.size > 1) return "ambiguous";
  const explicitLabel = single(explicit);
  if (explicitLabel) return { kind: "answer", label: explicitLabel };

  const words = text.split(" ");
  const strong = new Set<OptionLabel>();
  const weak = new Set<OptionLabel>();
  for (const word of words) {
    const s = STRONG_WORDS[word];
    if (s) strong.add(s);
    const w = WEAK_WORDS[word];
    if (w) weak.add(w);
  }
  if (strong.size > 1) return "ambiguous";
  const strongLabel = single(strong);
  if (strongLabel) return { kind: "answer", label: strongLabel };
  if (weak.size > 1) return "ambiguous";
  const weakLabel = single(weak);
  if (weakLabel) return { kind: "answer", label: weakLabel };
  return null;
}

/**
 * Interpret the recogniser's alternative transcripts (best first). The first alternative that
 * yields a definite command wins; an alternative naming two different options is ambiguous and
 * ignored, so a lone "a or b" gives null.
 */
export function parseSpokenCommand(transcripts: string[]): SpokenCommand | null {
  for (const transcript of transcripts) {
    if (typeof transcript !== "string") continue;
    const result = parseOne(normalize(transcript));
    if (result && result !== "ambiguous") return result;
  }
  return null;
}

/** True when `value` is one of the option labels (useful for keyboard handling). */
export function isOptionLabel(value: string): value is OptionLabel {
  return (OPTION_LABELS as readonly string[]).includes(value);
}
