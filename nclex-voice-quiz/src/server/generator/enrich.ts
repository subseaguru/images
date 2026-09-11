/**
 * Fills in what an imported question is missing, using Claude.
 *
 * Question sets written elsewhere (ChatGPT from a lecture, a study group's notes) usually carry the
 * scenario and the answer but no NCLEX classification and no per-option rationales. Enrichment adds
 * those without touching the question itself: the stem, the option texts and the keyed answer are
 * copied back from the original, never from the model's reply, so enrichment can only add
 * explanation - it can never quietly change what the question asks or which answer counts as right.
 *
 * If Claude believes the keyed answer is wrong or the question is unanswerable it returns a
 * `concern` instead; that question is left exactly as it was and surfaced to the learner to decide.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { CategoryId, Question } from "../../shared/types.js";
import { CATEGORY_IDS, CLINICAL_JUDGMENT_STEPS, DIFFICULTIES, OPTION_LABELS } from "../../shared/types.js";
import { getCategory } from "../../shared/blueprint.js";
import { PLACEHOLDER_RATIONALE, PLACEHOLDER_SUBTOPIC } from "../questions/normalize.js";
import { GeneratorError, toGeneratorError } from "./index.js";
import { renderBlueprint } from "./prompt.js";
import { isKnownSubtopic } from "./schema.js";

/** Questions per API call: big enough to be cheap, small enough to stay well inside max_tokens. */
export const ENRICH_BATCH_SIZE = 10;
const MAX_TOKENS = 16_000;
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const BETAS: Anthropic.Beta.AnthropicBeta[] = ["server-side-fallback-2026-07-01", "structured-outputs-2025-12-15"];

export interface EnrichContext {
  apiKey: string;
  model: string;
  now?: () => Date;
  fetch?: typeof globalThis.fetch;
  baseURL?: string;
}

export interface EnrichResult {
  /** Only the questions that changed, ready to be saved. */
  questions: Question[];
  flagged: { id: string; concern: string }[];
  warnings: string[];
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

const RationaleSchema = z.object({
  label: z.enum(OPTION_LABELS),
  rationale: z.string().describe("One to three sentences saying why this option is right or wrong, stating the principle a learner can reuse."),
});

const EnrichedSchema = z.object({
  id: z.string().describe("The id of the question being described, copied from the input."),
  category: z.enum(CATEGORY_IDS),
  subtopic: z.string().describe("An activity statement of that category, copied exactly from the test plan."),
  clinicalJudgmentStep: z.enum(CLINICAL_JUDGMENT_STEPS),
  difficulty: z.enum(DIFFICULTIES),
  rationales: z.array(RationaleSchema).describe("One entry per option, labels A, B and C."),
  teachingPoint: z.string().describe("One or two sentences with the transferable takeaway."),
  concern: z
    .string()
    .describe(
      "Empty string normally. If the keyed answer looks wrong, more than one option is defensible, or the question cannot be answered as written, describe the problem here in one or two sentences and leave the other fields as your best effort.",
    ),
});

const EnrichBatchSchema = z.object({ items: z.array(EnrichedSchema) });

const SYSTEM_ROLE = [
  "You are a nurse educator classifying and explaining NCLEX-RN practice questions written by someone else.",
  "",
  "For each question you are given the scenario, its three options and which option the author keyed as correct.",
  "Your job is to describe that question, never to rewrite it:",
  "- Classify it under the NCLEX-RN test plan: the Client Needs subcategory, one of that subcategory's activity statements (copied exactly), and the clinical-judgment step it mainly exercises.",
  "- Judge its difficulty for a candidate near the passing standard: easy, medium or hard.",
  "- Write a rationale for every option, explaining why the keyed answer is right and why each other option is wrong, in one to three sentences that state a principle the learner can reuse.",
  "- Write a teaching point: the transferable takeaway in one or two sentences.",
  "",
  "Rules:",
  "- Never restate, reword or correct the scenario, the option texts or the keyed answer. They are copied back from the original; only your explanations are kept.",
  "- Write the rationale for the keyed option as the correct one, even if you would have keyed it differently. If you believe the key is wrong, more than one option is defensible, or the question cannot be answered as written, say so in `concern` - that question is then left untouched for the learner to judge.",
  "- Everything is read aloud by a study app: plain text, abbreviations expanded on first use, numbers and units written out, no markdown, lists or symbols.",
  "- Use current United States evidence-based practice.",
].join("\n");

function systemBlocks(): Anthropic.Beta.BetaTextBlockParam[] {
  return [
    { type: "text", text: SYSTEM_ROLE },
    {
      type: "text",
      text: `Reference: the current NCLEX-RN test plan.\n\n${renderBlueprint()}`,
      cache_control: { type: "ephemeral" },
    },
  ];
}

/** What the model is allowed to see: the question as written, plus what is missing. */
export function renderQuestionForEnrichment(question: Question): string {
  const lines = [`<question id="${question.id}">`, `Scenario: ${question.stem}`];
  for (const option of question.options) {
    const placeholder = option.rationale === PLACEHOLDER_RATIONALE || !option.rationale;
    lines.push(`Option ${option.label}: ${option.text}${placeholder ? "" : `  [existing rationale: ${option.rationale}]`}`);
  }
  lines.push(`Keyed correct answer: ${question.correct}`);
  const known: string[] = [];
  if (question.category) known.push(`category: ${question.category}`);
  if (question.subtopic && question.subtopic !== PLACEHOLDER_SUBTOPIC) known.push(`activity statement: ${question.subtopic}`);
  if (question.clinicalJudgmentStep) known.push(`clinical judgment step: ${question.clinicalJudgmentStep}`);
  if (question.difficulty) known.push(`difficulty: ${question.difficulty}`);
  if (question.teachingPoint) known.push(`teaching point: ${question.teachingPoint}`);
  if (known.length > 0) {
    lines.push(`Values the author supplied (keep them unless they are clearly wrong): ${known.join("; ")}`);
  }
  lines.push("</question>");
  return lines.join("\n");
}

export function buildEnrichUserMessage(batch: readonly Question[]): string {
  return [
    `Describe these ${batch.length} question${batch.length === 1 ? "" : "s"}. Return one item per question, with the same id.`,
    "",
    batch.map(renderQuestionForEnrichment).join("\n\n"),
  ].join("\n");
}

function textOf(content: readonly Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function parseItems(text: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { items?: unknown }).items)) {
      return (parsed as { items: unknown[] }).items;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Applies one model answer to one question. Only missing or invalid fields are replaced, and the
 * stem, options and keyed answer are always the originals.
 */
export function applyEnrichment(
  question: Question,
  item: z.infer<typeof EnrichedSchema>,
): { question: Question; changed: boolean } {
  const updated: Question = { ...question, options: question.options.map((o) => ({ ...o })) };
  let changed = false;

  const hasCategory = (CATEGORY_IDS as readonly string[]).includes(question.category);
  if (!hasCategory || question.needsReview) {
    if (item.category !== question.category) {
      updated.category = item.category as CategoryId;
      changed = true;
    }
  }
  const categoryForSubtopic = updated.category;
  const subtopicMissing = !question.subtopic || question.subtopic === PLACEHOLDER_SUBTOPIC;
  const subtopicWrong = !subtopicMissing && !isKnownSubtopic(categoryForSubtopic, question.subtopic);
  if (subtopicMissing || subtopicWrong || updated.category !== question.category) {
    const candidate = item.subtopic.trim();
    const statements = getCategory(categoryForSubtopic).activityStatements;
    const exact = statements.find((s) => s.toLowerCase() === candidate.toLowerCase());
    const next = exact ?? (statements[0] as string);
    if (next !== question.subtopic) {
      updated.subtopic = next;
      changed = true;
    }
  }
  if (!question.clinicalJudgmentStep) {
    updated.clinicalJudgmentStep = item.clinicalJudgmentStep;
    changed = true;
  }
  if (!(DIFFICULTIES as readonly string[]).includes(question.difficulty)) {
    updated.difficulty = item.difficulty;
    changed = true;
  }
  const byLabel = new Map(item.rationales.map((r) => [r.label, r.rationale.trim()]));
  updated.options = updated.options.map((option) => {
    const existing = option.rationale.trim();
    if (existing && existing !== PLACEHOLDER_RATIONALE) return option;
    const replacement = byLabel.get(option.label);
    if (!replacement) return option;
    changed = true;
    return { ...option, rationale: replacement };
  });
  if (!question.teachingPoint && item.teachingPoint.trim()) {
    updated.teachingPoint = item.teachingPoint.trim();
    changed = true;
  }

  // The flag only clears once nothing is missing any more.
  const complete =
    updated.options.every((o) => o.rationale && o.rationale !== PLACEHOLDER_RATIONALE) &&
    Boolean(updated.teachingPoint) &&
    Boolean(updated.clinicalJudgmentStep) &&
    updated.subtopic !== PLACEHOLDER_SUBTOPIC;
  if (complete && updated.needsReview) {
    delete updated.needsReview;
    changed = true;
  }
  return { question: updated, changed };
}

export async function enrichQuestions(questions: readonly Question[], ctx: EnrichContext): Promise<EnrichResult> {
  if (!ctx.apiKey) throw new GeneratorError("No Claude API key is configured.", 400, "no_api_key");
  if (questions.length === 0) {
    return { questions: [], flagged: [], warnings: [], model: ctx.model, usage: { inputTokens: 0, outputTokens: 0 } };
  }

  const client = new Anthropic({
    apiKey: ctx.apiKey,
    baseURL: ctx.baseURL,
    fetch: ctx.fetch,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 2,
  });
  const format = betaZodOutputFormat(EnrichBatchSchema);
  const system = systemBlocks();

  const updated: Question[] = [];
  const flagged: { id: string; concern: string }[] = [];
  const warnings: string[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let servedBy = ctx.model;

  for (let start = 0; start < questions.length; start += ENRICH_BATCH_SIZE) {
    const batch = questions.slice(start, start + ENRICH_BATCH_SIZE);
    let msg: Anthropic.Beta.BetaMessage;
    try {
      msg = await client.beta.messages.create({
        model: ctx.model,
        max_tokens: MAX_TOKENS,
        betas: BETAS,
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: "medium", format },
        system,
        messages: [{ role: "user", content: buildEnrichUserMessage(batch) }],
      });
    } catch (err) {
      throw toGeneratorError(err, ctx.model);
    }
    servedBy = msg.model ?? servedBy;
    if (msg.usage) {
      usage.inputTokens +=
        (msg.usage.input_tokens ?? 0) +
        (msg.usage.cache_creation_input_tokens ?? 0) +
        (msg.usage.cache_read_input_tokens ?? 0);
      usage.outputTokens += msg.usage.output_tokens ?? 0;
    }

    // Stop reason before content, always: a refusal or a cut-off answer carries no usable JSON.
    if (msg.stop_reason === "refusal") {
      warnings.push(
        `Claude declined to describe questions ${start + 1}-${start + batch.length}${
          msg.stop_details?.explanation ? `: ${msg.stop_details.explanation}` : ""
        }.`,
      );
      continue;
    }
    const items = parseItems(textOf(msg.content));
    if (!items) {
      warnings.push(
        msg.stop_reason === "max_tokens"
          ? `The answer for questions ${start + 1}-${start + batch.length} was cut off; they were left unchanged.`
          : `Could not read the answer for questions ${start + 1}-${start + batch.length}; they were left unchanged.`,
      );
      continue;
    }

    const byId = new Map(batch.map((q) => [q.id, q]));
    for (const raw of items) {
      const parsed = EnrichedSchema.safeParse(raw);
      if (!parsed.success) {
        warnings.push("One answer did not match the expected shape and was ignored.");
        continue;
      }
      const question = byId.get(parsed.data.id);
      if (!question) {
        warnings.push(`Claude answered about an unknown question id "${parsed.data.id}"; it was ignored.`);
        continue;
      }
      byId.delete(parsed.data.id);
      const concern = parsed.data.concern.trim();
      if (concern) {
        flagged.push({ id: question.id, concern });
        continue;
      }
      const applied = applyEnrichment(question, parsed.data);
      if (applied.changed) updated.push(applied.question);
    }
    for (const missing of byId.values()) {
      warnings.push(`No answer came back for question ${missing.id}; it was left unchanged.`);
    }
  }

  return { questions: updated, flagged, warnings, model: servedBy, usage };
}
