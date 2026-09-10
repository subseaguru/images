/**
 * Structured-output schema for a generated question batch, plus the conversion from Claude's
 * output to `Question` objects.
 *
 * The zod schema is what the Claude API is asked to conform to (strict enums, descriptions that
 * double as instructions). Conversion is deliberately lenient about the shape of what comes back:
 * one malformed entry should cost one warning, not the whole batch.
 */
import { z } from "zod";
import type { CategoryId, Question } from "../../shared/types.js";
import { CATEGORY_IDS, CLINICAL_JUDGMENT_STEPS, DIFFICULTIES, OPTION_LABELS } from "../../shared/types.js";
import { getCategory } from "../../shared/blueprint.js";

export const GeneratedOptionSchema = z.object({
  label: z.enum(OPTION_LABELS).describe("Option label. The three options must be A, B and C in that order."),
  text: z.string().describe("Option text, spoken aloud. One sentence, homogeneous with the other options."),
  rationale: z
    .string()
    .describe("One to three sentences explaining the principle that makes this option right or wrong."),
});

export const GeneratedQuestionSchema = z.object({
  stem: z
    .string()
    .describe(
      "A realistic client scenario of 30 to 70 words ending in one clear question. Plain spoken prose, no lists or markdown.",
    ),
  options: z.array(GeneratedOptionSchema).describe("Exactly three options labelled A, B and C in order."),
  correct: z.enum(OPTION_LABELS).describe("Label of the single best answer."),
  category: z.enum(CATEGORY_IDS).describe("NCLEX-RN Client Needs subcategory id."),
  subtopic: z
    .string()
    .describe("Exactly one of the activity statements listed for the chosen category, copied verbatim."),
  clinicalJudgmentStep: z.enum(CLINICAL_JUDGMENT_STEPS).describe("The clinical-judgment step the item exercises."),
  difficulty: z.enum(DIFFICULTIES),
  teachingPoint: z
    .string()
    .describe("One short paragraph with the transferable takeaway the learner should remember."),
  references: z
    .array(z.string())
    .describe("Names of study sources or guidelines the question was grounded in (may be empty)."),
  tags: z.array(z.string()).describe("Short topical tags, e.g. 'insulin', 'delegation'."),
});

export const BatchSchema = z.object({
  questions: z.array(GeneratedQuestionSchema).describe("The requested questions, in any order."),
});

export type GeneratedQuestion = z.infer<typeof GeneratedQuestionSchema>;
export type GeneratedBatch = z.infer<typeof BatchSchema>;

/** Case-insensitive, whitespace-normalised form of a stem, used for duplicate detection. */
export function normaliseStem(stem: string): string {
  return stem.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Parse the raw JSON text Claude returned into the loose batch shape. Returns null when the text
 * is not JSON or has no `questions` array; per-entry validation happens in `toQuestions`.
 */
export function parseBatchText(text: string): { questions: unknown[] } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const questions = (parsed as { questions?: unknown }).questions;
  if (!Array.isArray(questions)) return null;
  return { questions };
}

export interface ConversionResult {
  questions: Question[];
  warnings: string[];
}

/**
 * Validate each generated entry, convert the survivors to `Question` objects and drop duplicates
 * (against the existing bank and within the batch). Every dropped entry produces one warning.
 */
export function toQuestions(
  entries: unknown[],
  opts: { now: Date; existingStems?: readonly string[] },
): ConversionResult {
  const warnings: string[] = [];
  const questions: Question[] = [];
  const seen = new Set((opts.existingStems ?? []).map(normaliseStem));
  const stamp = opts.now.getTime();
  const createdAt = opts.now.toISOString();

  entries.forEach((entry, index) => {
    const label = `Question ${index + 1}`;
    const checked = validateEntry(entry);
    if (!checked.ok) {
      warnings.push(`${label} was dropped: ${checked.problem}.`);
      return;
    }
    const q = checked.question;
    const key = normaliseStem(q.stem);
    if (seen.has(key)) {
      warnings.push(`${label} was dropped as a duplicate of an existing question: "${excerpt(q.stem)}".`);
      return;
    }
    seen.add(key);
    if (!isKnownSubtopic(q.category, q.subtopic)) {
      warnings.push(
        `${label} names a subtopic that is not an activity statement of its category ("${q.subtopic}"); kept anyway.`,
      );
    }
    questions.push({
      id: `ai-${stamp}-${index}`,
      stem: q.stem.trim(),
      options: q.options.map((o) => ({ label: o.label, text: o.text.trim(), rationale: o.rationale.trim() })),
      correct: q.correct,
      category: q.category,
      subtopic: q.subtopic.trim(),
      clinicalJudgmentStep: q.clinicalJudgmentStep,
      difficulty: q.difficulty,
      source: "ai",
      teachingPoint: q.teachingPoint.trim(),
      references: q.references.map((r) => r.trim()).filter(Boolean),
      tags: q.tags.map((t) => t.trim()).filter(Boolean),
      createdAt,
    });
  });

  return { questions, warnings };
}

type EntryCheck = { ok: true; question: GeneratedQuestion } | { ok: false; problem: string };

/** Validates one raw entry; the problem text names only the first defect found. */
function validateEntry(entry: unknown): EntryCheck {
  const fail = (problem: string): EntryCheck => ({ ok: false, problem });
  if (!entry || typeof entry !== "object") return fail("not an object");
  const raw = entry as Record<string, unknown>;
  // Missing lists are tolerated (they are optional on Question); everything else must be present.
  const candidate = {
    ...raw,
    references: Array.isArray(raw.references) ? raw.references : [],
    tags: Array.isArray(raw.tags) ? raw.tags : [],
  };
  const result = GeneratedQuestionSchema.safeParse(candidate);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.map(String).join(".") || "entry";
    return fail(`${path}: ${issue?.message ?? "invalid"}`);
  }
  const q = result.data;
  if (q.options.length !== 3) return fail(`expected 3 options, got ${q.options.length}`);
  const labels = q.options.map((o) => o.label);
  if (labels.some((l, i) => l !== OPTION_LABELS[i])) {
    return fail(`options must be labelled A, B, C in order (got ${labels.join(",")})`);
  }
  if (!labels.includes(q.correct)) return fail(`correct answer ${q.correct} is not one of the option labels`);
  for (const [field, value] of Object.entries({
    stem: q.stem,
    subtopic: q.subtopic,
    teachingPoint: q.teachingPoint,
  })) {
    if (!value.trim()) return fail(`${field} is empty`);
  }
  for (const o of q.options) {
    if (!o.text.trim()) return fail(`option ${o.label} text is empty`);
    if (!o.rationale.trim()) return fail(`option ${o.label} rationale is empty`);
  }
  const texts = new Set(q.options.map((o) => o.text.trim().toLowerCase()));
  if (texts.size !== 3) return fail("option texts are not distinct");
  return { ok: true, question: q };
}

function excerpt(text: string): string {
  const t = text.trim();
  return t.length > 60 ? `${t.slice(0, 57)}...` : t;
}

/** True when `subtopic` is one of the activity statements of `category` (case-insensitive). */
export function isKnownSubtopic(category: CategoryId, subtopic: string): boolean {
  const wanted = subtopic.trim().toLowerCase();
  return getCategory(category).activityStatements.some((s) => s.toLowerCase() === wanted);
}
