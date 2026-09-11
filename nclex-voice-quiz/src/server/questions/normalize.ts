/**
 * Repairs question sets written by other tools (ChatGPT, a spreadsheet export, a study group's
 * JSON) into the shape `validateQuestion` accepts.
 *
 * The goal is to accept anything whose meaning is recoverable and to be explicit about everything
 * it had to guess: a question that arrives without an NCLEX category, a rationale for every option
 * or a teaching point is imported and flagged `needsReview` rather than rejected, so nothing is
 * silently presented as curated. Only a question missing its stem, three usable options or the
 * correct answer is rejected.
 *
 * Pure module: no I/O, so the same code serves the HTTP import route and the command-line import.
 */
import type { OptionLabel } from "../../shared/types.js";
import { CATEGORY_IDS, CLINICAL_JUDGMENT_STEPS, DIFFICULTIES, OPTION_LABELS } from "../../shared/types.js";
import { classifyQuestion } from "./classify.js";

export const PLACEHOLDER_RATIONALE = "Rationale not provided yet.";
export const PLACEHOLDER_SUBTOPIC = "Unclassified";

export interface NormalizedQuestion {
  /** Ready for `validateQuestion`; absent when the entry could not be recovered. */
  value?: Record<string, unknown>;
  errors: string[];
  /** Texts of options discarded because the question had more than three. */
  droppedOptions: string[];
  /** Everything that had to be guessed or left blank, for the import report. */
  gaps: string[];
  /**
   * True when a gap affects how the question teaches or is mixed into a quiz: a guessed NCLEX
   * category, a missing activity statement, or an option with no rationale. A question missing
   * only a teaching point or a clinical-judgment step still studies correctly, so it is not
   * flagged - enrichment fills those in too when it runs.
   */
  needsReview: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Markdown emphasis and stray control characters would fail validation and read badly aloud. */
export function toPlainText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[*`#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstString(source: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function firstDefined(source: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") return source[key];
  }
  return undefined;
}

/** Accepts a bare array, `{ questions }`, `{ version, questions }`, or `{ items }`. */
export function extractQuestionList(payload: unknown): { list: unknown[] } | { error: string } {
  if (Array.isArray(payload)) return { list: payload };
  if (isRecord(payload)) {
    for (const key of ["questions", "items", "data"]) {
      const value = payload[key];
      if (Array.isArray(value)) return { list: value };
    }
  }
  return {
    error: 'Expected a list of questions: [ ... ], { "questions": [ ... ] } or { "version": 1, "questions": [ ... ] }.',
  };
}

interface RawOption {
  label?: string;
  text: string;
  rationale?: string;
}

/** Options may be objects, plain strings, or an object keyed by label. */
function readOptions(raw: unknown): RawOption[] {
  const out: RawOption[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") {
        out.push({ text: item });
      } else if (isRecord(item)) {
        const text = firstString(item, ["text", "option", "answer", "value", "label_text", "content"]);
        const label = firstString(item, ["label", "letter", "key", "id"]);
        const rationale = firstString(item, ["rationale", "explanation", "reason", "why", "feedback"]);
        out.push({ text, ...(label ? { label } : {}), ...(rationale ? { rationale } : {}) });
      }
    }
    return out;
  }
  if (isRecord(raw)) {
    // { "A": "...", "B": "..." } or { "1": "...", "2": "..." } - keep the writer's order.
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "string") out.push({ label: key, text: value });
      else if (isRecord(value)) {
        out.push({
          label: key,
          text: firstString(value, ["text", "option", "value", "content"]),
          ...(firstString(value, ["rationale", "explanation", "reason"])
            ? { rationale: firstString(value, ["rationale", "explanation", "reason"]) }
            : {}),
        });
      }
    }
  }
  return out;
}

/** Strips decoration from an answer label: "Option B)", "b.", "answer: b", " B " all mean B. */
function labelFromString(value: string): string {
  return value
    .trim()
    .replace(/^(option|answer|choice|letter)\b[\s:.\-)]*/i, "")
    .replace(/[).:\]]+$/, "")
    .trim()
    .toUpperCase();
}

/** Separate rationale maps: { A: "..." } or an array in option order. */
function readRationales(raw: unknown, count: number): string[] {
  const out: string[] = new Array(count).fill("");
  if (Array.isArray(raw)) {
    raw.forEach((item, index) => {
      if (index < count && typeof item === "string") out[index] = item;
    });
    return out;
  }
  if (isRecord(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value !== "string") continue;
      const label = labelFromString(key);
      const index = OPTION_LABELS.indexOf(label as OptionLabel);
      if (index >= 0 && index < count) out[index] = value;
      else {
        const asNumber = Number(label);
        if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= count) out[asNumber - 1] = value;
      }
    }
  }
  return out;
}

/**
 * Resolves which option is correct. Accepts a label (any decoration), the exact text of an option,
 * or a number: 0 means the first option (0-based), 1, 2 and 3 mean the first, second and third
 * (1-based) - the reading that matches how people write answer keys by hand.
 */
function resolveCorrectIndex(raw: unknown, options: RawOption[]): number {
  const labels = options.map((o) => (o.label ? labelFromString(o.label) : ""));
  if (typeof raw === "number" && Number.isInteger(raw)) {
    if (raw === 0) return 0;
    if (raw >= 1 && raw <= options.length) return raw - 1;
    return -1;
  }
  if (typeof raw !== "string") return -1;
  const trimmed = raw.trim();
  if (!trimmed) return -1;

  const asLabel = labelFromString(trimmed);
  if (asLabel.length === 1) {
    const byOwnLabel = labels.indexOf(asLabel);
    if (byOwnLabel >= 0) return byOwnLabel;
    // A letter beyond C is still meaningful while the question has more than three options
    // (a four-option set keyed "D"); the extra options are trimmed afterwards.
    const byPosition = asLabel.charCodeAt(0) - "A".charCodeAt(0);
    if (byPosition >= 0 && byPosition < options.length) return byPosition;
  }
  if (/^\d+$/.test(asLabel)) {
    const n = Number(asLabel);
    if (n === 0) return 0;
    if (n >= 1 && n <= options.length) return n - 1;
    return -1;
  }
  // The full text of the correct option (with or without a leading label).
  const needle = toPlainText(trimmed.replace(/^[A-Za-z][).:]\s*/, "")).toLowerCase();
  if (needle) {
    const exact = options.findIndex((o) => toPlainText(o.text).toLowerCase() === needle);
    if (exact >= 0) return exact;
  }
  return -1;
}

export interface NormalizeOptions {
  /** Overrides the guessed category (used by tests). */
  classify?: typeof classifyQuestion;
}

export function normalizeQuestion(raw: unknown, options: NormalizeOptions = {}): NormalizedQuestion {
  const classify = options.classify ?? classifyQuestion;
  const errors: string[] = [];
  const gaps: string[] = [];
  /** The subset of `gaps` that makes a question worth reviewing before it is trusted. */
  const substantive: string[] = [];
  const droppedOptions: string[] = [];

  if (!isRecord(raw)) return { errors: ["not an object"], droppedOptions, gaps, needsReview: false };

  const stem = toPlainText(firstString(raw, ["stem", "question", "prompt", "text", "questionText"]));
  if (!stem) errors.push("no question text found (expected a stem or question field)");

  let parsed = readOptions(firstDefined(raw, ["options", "choices", "answers", "answerOptions"]));
  parsed = parsed.filter((o) => toPlainText(o.text).length > 0);
  if (parsed.length < 3) errors.push(`needs at least 3 options, found ${parsed.length}`);

  const separateRationales = readRationales(firstDefined(raw, ["rationales", "explanations", "optionRationales"]), parsed.length);
  separateRationales.forEach((text, index) => {
    const option = parsed[index];
    if (option && text && !option.rationale) option.rationale = text;
  });

  const correctIndex = resolveCorrectIndex(
    firstDefined(raw, ["correct", "answer", "correctAnswer", "correct_option", "correctOption", "key", "correctIndex", "answerIndex"]),
    parsed,
  );
  if (parsed.length >= 3 && correctIndex < 0) errors.push("could not work out which option is correct");

  if (errors.length > 0) return { errors, droppedOptions, gaps, needsReview: false };

  // More than three options: keep the correct one and the first two distractors, in their original
  // order, then relabel A, B, C. The rest are reported so nothing disappears silently.
  let kept = parsed;
  if (parsed.length > 3) {
    const keepIndexes = new Set<number>([correctIndex]);
    for (let i = 0; i < parsed.length && keepIndexes.size < 3; i += 1) keepIndexes.add(i);
    const ordered = [...keepIndexes].sort((a, b) => a - b);
    kept = ordered.map((i) => parsed[i] as RawOption);
    parsed.forEach((option, index) => {
      if (!keepIndexes.has(index)) droppedOptions.push(toPlainText(option.text));
    });
  }
  const keptCorrect = kept.findIndex((option) => option === parsed[correctIndex]);
  const correctLabel = OPTION_LABELS[keptCorrect >= 0 ? keptCorrect : 0] as OptionLabel;

  const finalOptions = kept.map((option, index) => {
    const rationale = toPlainText(option.rationale ?? "");
    if (!rationale) {
      gaps.push(`rationale for option ${OPTION_LABELS[index]}`);
      substantive.push(`rationale for option ${OPTION_LABELS[index]}`);
    }
    return {
      label: OPTION_LABELS[index] as OptionLabel,
      text: toPlainText(option.text),
      rationale: rationale || PLACEHOLDER_RATIONALE,
    };
  });

  const rawCategory = firstString(raw, ["category", "clientNeeds", "client_needs", "categoryId"]);
  let category = (CATEGORY_IDS as readonly string[]).includes(rawCategory) ? rawCategory : "";
  if (!category) {
    const normalized = rawCategory.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z_]/g, "");
    if ((CATEGORY_IDS as readonly string[]).includes(normalized)) category = normalized;
  }
  if (!category) {
    category = classify(stem, finalOptions.map((o) => o.text)).category;
    gaps.push("NCLEX category (guessed from the wording)");
    substantive.push("NCLEX category");
  }

  const subtopic = toPlainText(firstString(raw, ["subtopic", "topic", "activityStatement", "subCategory"]));
  if (!subtopic) {
    gaps.push("activity statement");
    substantive.push("activity statement");
  }

  const rawStep = firstString(raw, ["clinicalJudgmentStep", "cjStep", "judgmentStep"]).trim().toLowerCase().replace(/[\s-]+/g, "_");
  const clinicalJudgmentStep = (CLINICAL_JUDGMENT_STEPS as readonly string[]).includes(rawStep) ? rawStep : undefined;
  if (!clinicalJudgmentStep) gaps.push("clinical judgment step");

  const rawDifficulty = firstString(raw, ["difficulty", "level"]).trim().toLowerCase();
  const difficulty = (DIFFICULTIES as readonly string[]).includes(rawDifficulty) ? rawDifficulty : "medium";

  const teachingPoint = toPlainText(firstString(raw, ["teachingPoint", "explanation", "takeaway", "keyPoint", "notes"]));
  if (!teachingPoint) gaps.push("teaching point");

  const stringList = (value: unknown): string[] => {
    if (typeof value === "string") return value.trim() ? [value.trim()] : [];
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((s) => s.trim());
  };

  const value: Record<string, unknown> = {
    stem,
    options: finalOptions,
    correct: correctLabel,
    category,
    subtopic: subtopic || PLACEHOLDER_SUBTOPIC,
    difficulty,
    references: stringList(firstDefined(raw, ["references", "sources", "source_titles"])),
    tags: stringList(firstDefined(raw, ["tags", "keywords"])),
  };
  // A date the author supplied is kept (it says when the set was written); anything else is
  // stamped by the validator at import time.
  const createdAt = firstString(raw, ["createdAt", "created_at", "date"]);
  if (createdAt && !Number.isNaN(Date.parse(createdAt))) value.createdAt = createdAt;
  if (clinicalJudgmentStep) value.clinicalJudgmentStep = clinicalJudgmentStep;
  if (teachingPoint) value.teachingPoint = teachingPoint;
  const needsReview = substantive.length > 0;
  if (needsReview) value.needsReview = true;

  return { value, errors: [], droppedOptions, gaps, needsReview };
}

/** Case- and whitespace-insensitive key used to spot the same question arriving twice. */
export function stemKey(stem: string): string {
  return stem.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ]/g, "").trim();
}
