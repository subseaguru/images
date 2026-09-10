/**
 * Question validation shared by seed loading, JSON import and Claude generation.
 *
 * Returns a cleaned copy (trimmed strings, only known fields) rather than the input object, so a
 * question that reaches the bank always has exactly the shape declared in `shared/types.ts`.
 */
import type {
  AnswerOption,
  ClinicalJudgmentStep,
  Difficulty,
  OptionLabel,
  Question,
  QuestionSource,
} from "../../shared/types.js";
import {
  CATEGORY_IDS,
  CLINICAL_JUDGMENT_STEPS,
  DIFFICULTIES,
  OPTION_LABELS,
  QUESTION_SOURCES,
} from "../../shared/types.js";

export const MIN_STEM_LENGTH = 20;

export type ValidationResult =
  | { ok: true; question: Question }
  | { ok: false; errors: string[] };

export interface ValidateOptions {
  /** Used when the input has no `source`; the caller usually forces one anyway. */
  defaultSource?: QuestionSource;
  /** Used when the input has no usable `id` (the store re-mints ids that are already taken). */
  defaultId?: string;
  now?: () => Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

/** Optional list of non-empty strings; `undefined` when absent, `null` when malformed. */
function cleanStringList(value: unknown): string[] | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const trimmed = item.trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}

const MARKDOWN_MARKERS = /[*`#]/;

export function validateQuestion(input: unknown, options: ValidateOptions = {}): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["question must be an object"] };

  const stem = cleanString(input.stem);
  if (stem === undefined || stem.length === 0) errors.push("stem is required");
  else if (stem.length < MIN_STEM_LENGTH) errors.push(`stem must be at least ${MIN_STEM_LENGTH} characters`);
  else if (MARKDOWN_MARKERS.test(stem)) errors.push("stem must be plain text (no markdown markers)");

  const options_: AnswerOption[] = [];
  if (!Array.isArray(input.options) || input.options.length !== 3) {
    errors.push("exactly 3 options are required");
  } else {
    const seenTexts = new Set<string>();
    input.options.forEach((raw: unknown, index: number) => {
      const expected = OPTION_LABELS[index] as OptionLabel;
      if (!isRecord(raw)) {
        errors.push(`option ${expected} must be an object`);
        return;
      }
      if (raw.label !== expected) errors.push(`option ${index + 1} must have label "${expected}"`);
      const text = cleanString(raw.text);
      const rationale = cleanString(raw.rationale);
      if (!text) errors.push(`option ${expected} text is required`);
      if (!rationale) errors.push(`option ${expected} rationale is required`);
      if (text) {
        const key = text.toLowerCase();
        if (seenTexts.has(key)) errors.push(`option ${expected} text duplicates another option`);
        seenTexts.add(key);
      }
      options_.push({ label: expected, text: text ?? "", rationale: rationale ?? "" });
    });
  }

  if (!isOneOf(input.correct, OPTION_LABELS)) errors.push("correct must be one of A, B, C");
  if (!isOneOf(input.category, CATEGORY_IDS)) errors.push("category is not a known CategoryId");
  if (!isOneOf(input.difficulty, DIFFICULTIES)) errors.push("difficulty must be easy, medium or hard");

  let clinicalJudgmentStep: ClinicalJudgmentStep | undefined;
  const rawStep = input.clinicalJudgmentStep;
  if (rawStep !== undefined && rawStep !== null && rawStep !== "") {
    if (isOneOf(rawStep, CLINICAL_JUDGMENT_STEPS)) clinicalJudgmentStep = rawStep;
    else errors.push("clinicalJudgmentStep is not a known step");
  }

  const subtopic = cleanString(input.subtopic);
  if (!subtopic) errors.push("subtopic is required");

  let source: QuestionSource | undefined;
  if (input.source === undefined || input.source === null) source = options.defaultSource ?? "imported";
  else if (isOneOf(input.source, QUESTION_SOURCES)) source = input.source;
  else errors.push("source must be bundled, ai or imported");

  const teachingPoint = input.teachingPoint === undefined || input.teachingPoint === null ? undefined : cleanString(input.teachingPoint);
  if (input.teachingPoint !== undefined && input.teachingPoint !== null && teachingPoint === undefined) {
    errors.push("teachingPoint must be a string");
  }
  const references = cleanStringList(input.references);
  if (references === null) errors.push("references must be an array of strings");
  const tags = cleanStringList(input.tags);
  if (tags === null) errors.push("tags must be an array of strings");

  let createdAt: string | undefined;
  if (input.createdAt === undefined || input.createdAt === null || input.createdAt === "") {
    createdAt = (options.now?.() ?? new Date()).toISOString();
  } else if (typeof input.createdAt === "string" && !Number.isNaN(Date.parse(input.createdAt))) {
    createdAt = input.createdAt;
  } else {
    errors.push("createdAt must be an ISO-8601 date string");
  }

  let id = cleanString(input.id);
  if (input.id !== undefined && input.id !== null && id === undefined) errors.push("id must be a string");
  if (!id) id = options.defaultId ?? "";

  if (errors.length > 0) return { ok: false, errors };

  const question: Question = {
    id,
    stem: stem as string,
    options: options_,
    correct: input.correct as OptionLabel,
    category: input.category as Question["category"],
    subtopic: subtopic as string,
    difficulty: input.difficulty as Difficulty,
    source: source as QuestionSource,
    createdAt: createdAt as string,
  };
  if (clinicalJudgmentStep) question.clinicalJudgmentStep = clinicalJudgmentStep;
  if (teachingPoint) question.teachingPoint = teachingPoint;
  if (references && references.length > 0) question.references = references;
  if (tags && tags.length > 0) question.tags = tags;
  return { ok: true, question };
}
