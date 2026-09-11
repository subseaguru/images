import { Router } from "express";
import type { ImportResponse, Question } from "../../shared/types.js";
import { CATEGORY_IDS, DIFFICULTIES, QUESTION_SOURCES } from "../../shared/types.js";
import type { QuestionStore } from "../questions/store.js";
import { importQuestions } from "../questions/import.js";
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
    const needsReview = queryString(req.query.needsReview) === "1";
    res.json({
      questions: needsReview ? list.filter((q) => q.needsReview === true) : list,
      counts: questions.counts(),
    });
  });

  router.post("/questions/import", async (req, res) => {
    // Deliberately lenient: question sets written by other tools are repaired where their meaning
    // is recoverable and flagged for review, instead of being rejected wholesale.
    const report: ImportResponse = await importQuestions(req.body, questions);
    res.json(report);
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
