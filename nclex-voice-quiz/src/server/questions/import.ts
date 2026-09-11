/**
 * Shared import pipeline: normalize -> validate -> skip duplicates -> store.
 *
 * Used by POST /api/questions/import and by `npm run import`, so the browser and the command line
 * behave identically on the same file.
 */
import type { ImportResponse, Question } from "../../shared/types.js";
import { badRequest } from "../routes/http.js";
import { extractQuestionList, normalizeQuestion, stemKey } from "./normalize.js";
import type { QuestionStore } from "./store.js";
import { validateQuestion } from "./validate.js";

export async function importQuestions(payload: unknown, store: QuestionStore): Promise<ImportResponse> {
  const extracted = extractQuestionList(payload);
  if ("error" in extracted) throw badRequest(extracted.error, "invalid_import");

  const rejected: { index: number; errors: string[] }[] = [];
  const dropped: { index: number; options: string[] }[] = [];
  const valid: Question[] = [];
  const seen = new Set(store.stems().map(stemKey));
  let skippedDuplicates = 0;
  let needsReview = 0;

  extracted.list.forEach((raw, index) => {
    const normalized = normalizeQuestion(raw);
    if (!normalized.value) {
      rejected.push({ index, errors: normalized.errors });
      return;
    }
    const result = validateQuestion(normalized.value, { defaultSource: "imported" });
    if (!result.ok) {
      rejected.push({ index, errors: result.errors });
      return;
    }
    const key = stemKey(result.question.stem);
    if (seen.has(key)) {
      skippedDuplicates += 1;
      return;
    }
    seen.add(key);
    if (normalized.droppedOptions.length > 0) dropped.push({ index, options: normalized.droppedOptions });
    // The store mints ids for imported questions, so incoming ids never collide with the bank.
    const question: Question = { ...result.question, id: "", source: "imported" };
    if (question.needsReview) needsReview += 1;
    valid.push(question);
  });

  const stored = await store.addMany(valid);
  return { imported: stored.length, skippedDuplicates, rejected, needsReview, dropped };
}
