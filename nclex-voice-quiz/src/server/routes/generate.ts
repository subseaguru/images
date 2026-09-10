import { Router } from "express";
import type { GenerateRequest, GenerateResponse, Question } from "../../shared/types.js";
import { CATEGORY_IDS, CLINICAL_JUDGMENT_STEPS, DIFFICULTIES } from "../../shared/types.js";
import type { GeneratorContext, GeneratorSource, generateQuestions } from "../generator/index.js";
import type { QuestionStore } from "../questions/store.js";
import { validateQuestion } from "../questions/validate.js";
import type { AttemptStore } from "../quiz/progress.js";
import { computeStats } from "../quiz/progress.js";
import type { SettingsStore } from "../settings.js";
import type { SourceStore } from "../sources/store.js";
import {
  badRequest,
  bodyObject,
  optionalBoolean,
  optionalEnum,
  optionalEnumList,
  optionalString,
  optionalStringList,
  requiredNumber,
} from "./http.js";

export const MAX_GENERATE_COUNT = 20;

export function parseGenerateRequest(body: Record<string, unknown>): GenerateRequest {
  const count = Math.round(requiredNumber(body.count, "count", 1, MAX_GENERATE_COUNT));
  const request: GenerateRequest = { count };
  const categories = optionalEnumList(body.categories, CATEGORY_IDS, "categories");
  const difficulty = optionalEnum(body.difficulty, DIFFICULTIES, "difficulty");
  const steps = optionalEnumList(body.clinicalJudgmentSteps, CLINICAL_JUDGMENT_STEPS, "clinicalJudgmentSteps");
  const sourceIds = optionalStringList(body.sourceIds, "sourceIds");
  const research = optionalBoolean(body.research, "research");
  const targetWeakAreas = optionalBoolean(body.targetWeakAreas, "targetWeakAreas");
  const focus = optionalString(body.focus, "focus", 2000);
  const save = optionalBoolean(body.save, "save");
  if (categories && categories.length > 0) request.categories = categories;
  if (difficulty) request.difficulty = difficulty;
  if (steps && steps.length > 0) request.clinicalJudgmentSteps = steps;
  if (sourceIds && sourceIds.length > 0) request.sourceIds = [...new Set(sourceIds)];
  if (research !== undefined) request.research = research;
  if (targetWeakAreas !== undefined) request.targetWeakAreas = targetWeakAreas;
  if (focus) request.focus = focus;
  if (save !== undefined) request.save = save;
  return request;
}

export function generateRouter(deps: {
  questions: QuestionStore;
  attempts: AttemptStore;
  sources: SourceStore;
  settings: SettingsStore;
  envApiKey?: string;
  generateQuestions: typeof generateQuestions;
}): Router {
  const router = Router();

  router.post("/generate", async (req, res) => {
    // Generation can run for minutes; make sure neither socket nor response gives up first.
    req.setTimeout(0);
    res.setTimeout(0);

    const request = parseGenerateRequest(bodyObject(req));
    const apiKey = deps.settings.effectiveApiKey(deps.envApiKey);
    if (!apiKey) {
      throw badRequest(
        "No Anthropic API key is configured. Add your key in Settings (or set ANTHROPIC_API_KEY) to generate questions.",
        "no_api_key",
      );
    }

    const sources: GeneratorSource[] = [];
    for (const id of request.sourceIds ?? []) {
      const found = await deps.sources.get(id);
      if (!found) throw badRequest(`Unknown study source: ${id}.`, "unknown_source");
      sources.push({ id: found.source.id, name: found.source.name, text: found.text });
    }

    const ctx: GeneratorContext = {
      apiKey,
      model: deps.settings.model,
      sources,
      existingStems: deps.questions.stems(),
    };
    if (request.targetWeakAreas) ctx.stats = computeStats(deps.attempts.list());

    const result = await deps.generateQuestions(request, ctx);

    const warnings = [...(result.warnings ?? [])];
    const valid: Question[] = [];
    (result.questions ?? []).forEach((raw, index) => {
      const checked = validateQuestion(raw, { defaultSource: "ai" });
      if (!checked.ok) {
        warnings.push(`Dropped generated question ${index + 1}: ${checked.errors.join("; ")}`);
        return;
      }
      valid.push({ ...checked.question, source: "ai" });
    });

    const questions = request.save === false ? valid : await deps.questions.addMany(valid);
    const response: GenerateResponse = {
      questions,
      model: result.model,
      usage: result.usage,
      warnings,
    };
    if (result.researchBrief) response.researchBrief = result.researchBrief;
    res.json(response);
  });

  return router;
}
