/**
 * Prompt construction for the question generator. Everything here is a pure function of its
 * inputs so the prompts can be unit-tested without touching the Claude API.
 *
 * Layout matters for prompt caching: the system prompt is stable across requests (role, item
 * writing rules, blueprint) and ends with a cache breakpoint; everything that changes per request
 * (counts, focus, weak areas, research brief, study sources, existing stems) lives in the user
 * message so it never invalidates the cached prefix.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { CategoryId, GenerateRequest, Stats } from "../../shared/types.js";
import { CATEGORY_IDS } from "../../shared/types.js";
import {
  NCLEX_RN_BLUEPRINT,
  blueprintDistribution,
  categoryName,
  clinicalJudgmentStepName,
  isCategoryId,
} from "../../shared/blueprint.js";
import type { GeneratorSource } from "./index.js";

/** Total characters of study-source text we are willing to send in one request. */
export const SOURCE_CHAR_CAP = 200_000;
/** Existing stems beyond this many are summarised by count; the local dedupe still covers them all. */
export const EXISTING_STEM_CAP = 500;
/** Share of the batch that may be redirected to weak categories when the learner asks for it. */
const WEAK_AREA_SHARE = 0.4;

export const MIN_COUNT = 1;
export const MAX_COUNT = 20;

export function clampCount(count: number): number {
  if (!Number.isFinite(count)) return 10;
  return Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(count)));
}

// ---------------------------------------------------------------------------------------------
// Blueprint rendering
// ---------------------------------------------------------------------------------------------

export function renderBlueprint(): string {
  const b = NCLEX_RN_BLUEPRINT;
  const lines: string[] = [];
  lines.push(`${b.name} (effective ${b.effective})`);
  lines.push(`Source: ${b.source}`);
  lines.push("");
  lines.push(`Exam format: ${b.examFormat}`);
  lines.push("");
  lines.push("Client Needs subcategories (share of scored items), with the activity statements each one tests:");
  b.categories.forEach((c, i) => {
    lines.push("");
    lines.push(`${i + 1}. ${c.name} [id: ${c.id}] - ${c.group} - ${c.minPercent} to ${c.maxPercent} percent`);
    lines.push(`   ${c.description}`);
    lines.push("   Activity statements:");
    for (const s of c.activityStatements) lines.push(`   - ${s}`);
  });
  lines.push("");
  lines.push("Clinical judgment steps (NCSBN Clinical Judgment Measurement Model, layer 3):");
  for (const s of b.clinicalJudgmentSteps) lines.push(`- ${s.id} (${s.name}): ${s.description}`);
  lines.push("");
  lines.push("Integrated processes woven through every category:");
  for (const p of b.integratedProcesses) lines.push(`- ${p}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------------------------

const ROLE = [
  "You are an expert NCLEX-RN item writer and nurse educator. You have written and reviewed",
  "thousands of licensure-style items, you know the NCSBN test plan and the Clinical Judgment",
  "Measurement Model in depth, and you keep up with current United States evidence-based nursing",
  "practice. You write original practice questions for a single learner who is preparing for the",
  "NCLEX-RN with a spoken-question study app.",
].join(" ");

const ITEM_WRITING_RULES = `Item-writing rules (apply to every question):
- Exactly one clearly best answer, keyed in "correct". The other two options are plausible but clearly inferior distractors that a weak candidate would be tempted to choose (a common misconception, a right action at the wrong time, an intervention for a different problem).
- The stem is a realistic client scenario of 30 to 70 words with the cues a nurse would actually have (age, setting, history, assessment findings, vital signs, laboratory values, medications) and it ends in one clear question, such as "Which action should the nurse take first?", "Which finding requires immediate follow-up?", "Which statement by the client indicates understanding of the teaching?" or "Which assessment finding is most consistent with this condition?".
- Options are homogeneous in form (all actions, or all findings, or all statements) and of similar length so length or grammar never gives the answer away.
- Never use "all of the above", "none of the above", absolutes such as "always" or "never", or trick wording. Avoid negatively phrased stems ("which should the nurse NOT do") unless there is no other way to test the point.
- Every option gets a rationale of one to three sentences that states the principle that makes it right or wrong, so a learner who chose it learns something specific.
- Provide a transferable teachingPoint: the rule or priority framework the learner should carry to similar questions, not a restatement of the answer.
- "subtopic" must be exactly one of the activity statements listed under the chosen category in the blueprint, copied verbatim.
- Set clinicalJudgmentStep to the step the item exercises and difficulty to the level requested.
- Reflect current United States evidence-based practice, standard precautions, medication safety and the priority frameworks used on the exam (airway-breathing-circulation, Maslow, safety first, nursing process, least restrictive intervention, delegation rules).
- Content must be original: never reproduce or closely paraphrase published or copyrighted exam items.
- Do not duplicate any of the existing stems listed in the request; vary clients, settings and conditions across the batch.
- Balance the correct label across A, B and C within the batch so that no letter dominates.`;

const SPOKEN_RULES = `Spoken-friendly writing (the app reads every question aloud and the learner answers by voice):
- Write for the ear. Expand abbreviations on first use ("intravenous", "blood pressure", "milligrams per deciliter"), then a short form is fine.
- Write numbers and units naturally and unambiguously, for example "0.5 milligrams", "a heart rate of 48 beats per minute", "a potassium level of 6.2 milliequivalents per liter".
- Plain prose only: no bullet lists, tables, markdown, exhibits, images or "select all that apply". Everything must make sense when heard once without seeing it.
- Option texts should be a single sentence or phrase that reads naturally after "Option A".`;

const OUTPUT_NOTE = `Output: return only the JSON object that matches the provided schema, with one entry per requested question. Use the category ids from the blueprint (for example "management_of_care"). Put the names of the study sources or guidelines you drew on in "references" and a few short topical words in "tags".`;

/**
 * System prompt as content blocks. The last block carries the cache breakpoint so the whole
 * stable prefix (role, rules, blueprint) is cached across generation requests.
 */
export function buildSystemBlocks(): Anthropic.Beta.BetaTextBlockParam[] {
  return [
    { type: "text", text: [ROLE, "", ITEM_WRITING_RULES, "", SPOKEN_RULES, "", OUTPUT_NOTE].join("\n") },
    {
      type: "text",
      text: `Reference: the current NCLEX-RN test plan.\n\n${renderBlueprint()}`,
      cache_control: { type: "ephemeral" },
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Category planning
// ---------------------------------------------------------------------------------------------

export interface WeakArea {
  category: CategoryId;
  /** 0..1, or null when the learner has not attempted the category. */
  accuracy: number | null;
}

/** Weak categories (worst first) with their accuracy, restricted to `allowed` when given. */
export function weakAreasFrom(stats: Stats | undefined, allowed?: readonly CategoryId[]): WeakArea[] {
  if (!stats) return [];
  const allowedSet = allowed && allowed.length > 0 ? new Set(allowed) : null;
  return stats.weakCategories
    .filter((c) => isCategoryId(c) && (!allowedSet || allowedSet.has(c)))
    .map((category) => ({
      category,
      accuracy: stats.byCategory.find((s) => s.category === category)?.accuracy ?? null,
    }));
}

/**
 * Decide how many questions each category should get. Starts from the blueprint split (within
 * the requested categories when given) and, when the learner asked to target weak areas, moves
 * up to 40% of the batch toward the weak categories. A donor category keeps at least one
 * question unless the weak category would otherwise get none at all.
 */
export function planCategoryCounts(
  count: number,
  categories: readonly CategoryId[] | undefined,
  weakAreas: readonly WeakArea[] = [],
): Record<CategoryId, number> {
  const chosen = (categories ?? []).filter(isCategoryId);
  const counts = blueprintDistribution(count, chosen);
  if (weakAreas.length === 0 || count < 2) return counts;

  const weak = weakAreas.map((w) => w.category);
  const weakSet = new Set(weak);
  const donorFor = (target: CategoryId): CategoryId | undefined => {
    const best = CATEGORY_IDS.filter((id) => !weakSet.has(id) && counts[id] > 0).sort(
      (a, b) => counts[b] - counts[a],
    )[0];
    if (!best) return undefined;
    return counts[best] > 1 || counts[target] === 0 ? best : undefined;
  };

  let budget = Math.floor(count * WEAK_AREA_SHARE);
  let moved = true;
  // One question at a time, weakest category first, until the budget is spent or nothing can move.
  while (budget > 0 && moved) {
    moved = false;
    for (const target of weak) {
      if (budget === 0) break;
      const donor = donorFor(target);
      if (!donor) continue;
      counts[donor] -= 1;
      counts[target] += 1;
      budget -= 1;
      moved = true;
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------------------------
// Study sources
// ---------------------------------------------------------------------------------------------

export interface PreparedSources {
  sources: GeneratorSource[];
  warnings: string[];
}

/**
 * Keep the combined source text under `cap` characters by trimming the longest sources down to a
 * common ceiling (water-filling), so short sources are never touched and long ones lose the same
 * amount. Truncated sources are named in a warning.
 */
export function prepareSources(sources: readonly GeneratorSource[], cap: number = SOURCE_CHAR_CAP): PreparedSources {
  const total = sources.reduce((sum, s) => sum + s.text.length, 0);
  if (total <= cap) return { sources: [...sources], warnings: [] };

  const lengths = sources.map((s) => s.text.length).sort((a, b) => a - b);
  let ceiling = 0;
  let remaining = cap;
  for (let i = 0; i < lengths.length; i += 1) {
    const share = Math.floor(remaining / (lengths.length - i));
    const len = lengths[i] ?? 0;
    if (len <= share) {
      remaining -= len;
      continue;
    }
    ceiling = share;
    break;
  }

  const truncated: string[] = [];
  const trimmed = sources.map((s) => {
    if (s.text.length <= ceiling) return s;
    truncated.push(s.name);
    return { ...s, text: `${s.text.slice(0, ceiling)}\n[... truncated for length ...]` };
  });
  const warnings = [
    `Study sources exceeded ${cap.toLocaleString("en-US")} characters; the longest were truncated: ${truncated.join(", ")}.`,
  ];
  return { sources: trimmed, warnings };
}

// ---------------------------------------------------------------------------------------------
// User message
// ---------------------------------------------------------------------------------------------

export interface UserMessageInput {
  request: GenerateRequest;
  /** Number of questions to ask for in this call (may be smaller than request.count on retry). */
  count: number;
  counts: Record<CategoryId, number>;
  weakAreas: readonly WeakArea[];
  researchBrief?: string;
  sources: readonly GeneratorSource[];
  existingStems: readonly string[];
}

function formatPercent(accuracy: number | null): string {
  return accuracy === null ? "not attempted yet" : `${Math.round(accuracy * 100)}% correct`;
}

function escapeSourceName(name: string): string {
  return name.replace(/["<>]/g, " ").trim() || "source";
}

/** Human-readable request block: what to write, how many of each category, at which difficulty. */
export function renderRequest(input: Pick<UserMessageInput, "request" | "count" | "counts" | "weakAreas">): string {
  const { request, count, counts, weakAreas } = input;
  const lines: string[] = [];
  lines.push(`Write ${count} NCLEX-RN practice question${count === 1 ? "" : "s"}.`);
  const plan = CATEGORY_IDS.filter((id) => counts[id] > 0).map((id) => `- ${categoryName(id)} [${id}]: ${counts[id]}`);
  const followsBlueprint = !request.categories || request.categories.length === 0;
  lines.push(
    followsBlueprint
      ? "Spread them across the test plan in these proportions (blueprint weighting):"
      : "Distribute them across the requested categories like this:",
  );
  lines.push(...plan);
  lines.push(`Difficulty: ${request.difficulty ?? "medium"}.`);
  if (request.clinicalJudgmentSteps && request.clinicalJudgmentSteps.length > 0) {
    lines.push(
      `Clinical judgment steps to exercise (use only these): ${request.clinicalJudgmentSteps
        .map((s) => `${s} (${clinicalJudgmentStepName(s)})`)
        .join(", ")}.`,
    );
  } else {
    lines.push("Clinical judgment steps: mix them across the batch.");
  }
  if (request.focus?.trim()) {
    lines.push(`Focus: ${request.focus.trim()}. Every question should serve this focus where the category allows it.`);
  }
  if (weakAreas.length > 0) {
    lines.push("");
    lines.push("The learner's weakest categories (worst first) - the plan above already leans toward them; make these items especially instructive:");
    for (const w of weakAreas) lines.push(`- ${categoryName(w.category)} [${w.category}]: ${formatPercent(w.accuracy)}`);
  }
  return lines.join("\n");
}

export function buildUserMessage(input: UserMessageInput): string {
  const parts: string[] = [renderRequest(input)];

  if (input.researchBrief?.trim()) {
    parts.push(
      [
        "Research brief compiled just before this request (current test-plan emphasis, guidelines and pitfalls). Use it to keep the content current and cite its sources in references where relevant:",
        "<research_brief>",
        input.researchBrief.trim(),
        "</research_brief>",
      ].join("\n"),
    );
  }

  if (input.sources.length > 0) {
    const blocks = input.sources.map(
      (s) => `<source name="${escapeSourceName(s.name)}">\n${s.text.trim()}\n</source>`,
    );
    parts.push(
      [
        `Study sources selected by the learner (${input.sources.length}). Ground questions in them where relevant, prefer their terminology and thresholds, and cite the source name in "references" for every question that draws on one:`,
        ...blocks,
      ].join("\n"),
    );
  }

  if (input.existingStems.length > 0) {
    const shown = input.existingStems.slice(0, EXISTING_STEM_CAP);
    const more = input.existingStems.length - shown.length;
    parts.push(
      [
        `Existing question stems already in the learner's bank (${input.existingStems.length}). Do not duplicate or lightly rephrase any of them:`,
        "<existing_stems>",
        ...shown.map((s) => `- ${s.replace(/\s+/g, " ").trim()}`),
        ...(more > 0 ? [`- (and ${more} more not listed; keep every new scenario distinct)`] : []),
        "</existing_stems>",
      ].join("\n"),
    );
  }

  parts.push(`Return exactly ${input.count} question${input.count === 1 ? "" : "s"} as JSON matching the schema.`);
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------------------------
// Research prompt
// ---------------------------------------------------------------------------------------------

export const RESEARCH_SYSTEM = [
  "You are a nurse educator preparing a short briefing for an NCLEX-RN item writer. Use web search",
  "to check current information rather than relying on memory, prefer primary sources (NCSBN, CDC,",
  "American Heart Association, professional nursing organisations, FDA, major guideline bodies), and",
  "write a concise plain-text brief - no markdown headings, tables or bullet symbols, just short",
  "labelled paragraphs. Name the source for each claim in parentheses. Do not write any exam questions.",
].join(" ");

export function buildResearchUserMessage(input: Pick<UserMessageInput, "request" | "counts">): string {
  const cats = CATEGORY_IDS.filter((id) => input.counts[id] > 0).map((id) => categoryName(id));
  const lines = [
    "Compile a research brief (roughly 400 to 800 words) for a batch of NCLEX-RN practice questions.",
    `Categories: ${cats.join("; ")}.`,
  ];
  if (input.request.focus?.trim()) lines.push(`Focus topics: ${input.request.focus.trim()}.`);
  lines.push(
    "",
    "Cover, in this order:",
    "1. What the current NCSBN NCLEX-RN test plan emphasises for these categories and focus topics (activity statements, clinical judgment model, item formats).",
    "2. Current clinical guidelines and evidence-based practice points relevant to the focus topics (thresholds, first-line actions, medication safety, recent changes).",
    "3. Common candidate pitfalls and misconceptions in these areas that good distractors can target.",
    "Finish with a short list of the source names you relied on.",
  );
  return lines.join("\n");
}
