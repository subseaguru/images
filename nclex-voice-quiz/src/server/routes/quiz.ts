import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { Attempt, AttemptResponse, InputMode, QuizStartRequest, QuizStartResponse } from "../../shared/types.js";
import { CATEGORY_IDS, DIFFICULTIES, OPTION_LABELS, QUESTION_SOURCES } from "../../shared/types.js";
import type { QuestionStore } from "../questions/store.js";
import type { AttemptStore } from "../quiz/progress.js";
import { computeStats, RECENT_DAYS, recentlyAnsweredIds, summarizeSession } from "../quiz/progress.js";
import { selectQuestions } from "../quiz/select.js";
import {
  badRequest,
  bodyObject,
  notFound,
  optionalBoolean,
  optionalEnum,
  optionalEnumList,
  optionalNumber,
  requiredNumber,
  requiredString,
} from "./http.js";

const INPUT_MODES: readonly InputMode[] = ["voice", "tap", "keyboard"];

export function quizRouter(deps: { questions: QuestionStore; attempts: AttemptStore }): Router {
  const router = Router();
  const { questions, attempts } = deps;

  router.post("/quiz/start", (req, res) => {
    const body = bodyObject(req);
    const request: QuizStartRequest = { count: requiredNumber(body.count, "count") };
    const categories = optionalEnumList(body.categories, CATEGORY_IDS, "categories");
    const sources = optionalEnumList(body.sources, QUESTION_SOURCES, "sources");
    const difficulty = optionalEnumList(body.difficulty, DIFFICULTIES, "difficulty");
    const adaptive = optionalBoolean(body.adaptive, "adaptive");
    const avoidRecent = optionalBoolean(body.avoidRecent, "avoidRecent");
    if (categories) request.categories = categories;
    if (sources) request.sources = sources;
    if (difficulty) request.difficulty = difficulty;
    if (adaptive !== undefined) request.adaptive = adaptive;
    if (avoidRecent !== undefined) request.avoidRecent = avoidRecent;

    const history = attempts.list();
    const stats = request.adaptive !== false ? computeStats(history) : undefined;
    const recent = request.avoidRecent !== false ? recentlyAnsweredIds(history, RECENT_DAYS) : new Set<string>();
    const selected = selectQuestions(questions.all(), request, stats, recent);
    if (selected.length === 0) {
      throw badRequest("No questions match the selected categories, sources and difficulty.", "no_questions");
    }
    const response: QuizStartResponse = { sessionId: randomUUID(), questions: selected };
    res.json(response);
  });

  router.post("/attempts", async (req, res) => {
    const body = bodyObject(req);
    const sessionId = requiredString(body.sessionId, "sessionId", 200);
    const questionId = requiredString(body.questionId, "questionId", 200);
    const chosen = optionalEnum(body.chosen, OPTION_LABELS, "chosen");
    if (!chosen) throw badRequest("chosen must be one of A, B, C.", "invalid_chosen");
    const inputMode = optionalEnum(body.inputMode, INPUT_MODES, "inputMode");
    if (!inputMode) throw badRequest("inputMode must be voice, tap or keyboard.", "invalid_inputMode");
    const responseMs = optionalNumber(body.responseMs, "responseMs", 0);

    const question = questions.get(questionId);
    if (!question) throw notFound("Question not found.", "question_not_found");

    const attempt: Attempt = {
      id: `att-${randomUUID()}`,
      sessionId,
      questionId,
      category: question.category,
      chosen,
      correct: question.correct,
      isCorrect: chosen === question.correct,
      answeredAt: new Date().toISOString(),
      inputMode,
    };
    if (responseMs !== undefined) attempt.responseMs = Math.round(responseMs);
    await attempts.add(attempt);
    const response: AttemptResponse = { attempt, isCorrect: attempt.isCorrect, correct: question.correct };
    res.json(response);
  });

  router.get("/sessions/:sessionId", (req, res) => {
    const sessionId = String(req.params.sessionId);
    const own = attempts.bySession(sessionId);
    if (own.length === 0) throw notFound("No attempts recorded for that session.", "session_not_found");
    res.json({ sessionId, attempts: own, summary: summarizeSession(sessionId, own) });
  });

  router.get("/stats", (_req, res) => {
    res.json(computeStats(attempts.list()));
  });

  router.delete("/stats", async (_req, res) => {
    await attempts.clear();
    res.json({ ok: true });
  });

  return router;
}
