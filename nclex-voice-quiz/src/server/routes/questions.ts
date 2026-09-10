import { Router } from "express";
import type { Question } from "../../shared/types.js";
import { CATEGORY_IDS, DIFFICULTIES, QUESTION_SOURCES } from "../../shared/types.js";
import type { QuestionStore } from "../questions/store.js";
import { validateQuestion } from "../questions/validate.js";
import { badRequest, bodyObject, notFound, optionalEnumList, queryList, queryString } from "./http.js";

export function questionsRouter(deps: { questions: QuestionStore }): Router {
  const router = Router();
  const { questions } = deps;

  router.get("/questions", (req, res) => {
    const list = questions.list({
      categories: optionalEnumList(queryList(req.query.category), CATEGORY_IDS, "category"),
      sources: optionalEnumList(queryList(req.query.source), QUESTION_SOURCES, "source"),
      difficulty: optionalEnumList(queryList(req.query.difficulty), DIFFICULTIES, "difficulty"),
      q: queryString(req.query.q),
    });
    res.json({ questions: list, counts: questions.counts() });
  });

  router.post("/questions/import", async (req, res) => {
    const body = bodyObject(req);
    if (!Array.isArray(body.questions)) {
      throw badRequest('Expected a question file: { "version": 1, "questions": [...] }.', "invalid_import");
    }
    const rejected: { index: number; errors: string[] }[] = [];
    const valid: Question[] = [];
    const seenIds = new Set<string>();
    body.questions.forEach((raw, index) => {
      const result = validateQuestion(raw, { defaultSource: "imported" });
      if (!result.ok) {
        rejected.push({ index, errors: result.errors });
        return;
      }
      const question: Question = { ...result.question, source: "imported" };
      // Duplicates inside the same import file also get fresh ids.
      if (question.id && seenIds.has(question.id)) question.id = "";
      if (question.id) seenIds.add(question.id);
      valid.push(question);
    });
    const stored = await questions.addMany(valid);
    res.json({ imported: stored.length, rejected });
  });

  router.get("/questions/:id", (req, res) => {
    const question = questions.get(String(req.params.id));
    if (!question) throw notFound("Question not found.", "question_not_found");
    res.json(question);
  });

  router.delete("/questions/:id", async (req, res) => {
    const outcome = await questions.delete(String(req.params.id));
    if (outcome === "missing") throw notFound("Question not found.", "question_not_found");
    if (outcome === "bundled") throw badRequest("Bundled questions cannot be deleted.", "bundled_question");
    res.json({ ok: true });
  });

  return router;
}
