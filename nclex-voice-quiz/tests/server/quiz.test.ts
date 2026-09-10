import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createApp } from "../../src/server/app.js";
import { PROJECT_ROOT } from "../../src/server/paths.js";
import { QuestionStore } from "../../src/server/questions/store.js";
import { computeStats, recentlyAnsweredIds } from "../../src/server/quiz/progress.js";
import { applyAdaptiveShift, selectQuestions } from "../../src/server/quiz/select.js";
import { blueprintDistribution } from "../../src/shared/blueprint.js";
import type { Attempt, AttemptResponse, CategoryId, Question, QuizStartResponse, Stats } from "../../src/shared/types.js";
import { CATEGORY_IDS } from "../../src/shared/types.js";

const SEED_DIR = path.join(PROJECT_ROOT, "tests", "fixtures", "seed");

async function startServer() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "nclex-quiz-"));
  const { app, stores } = createApp({ dataDir, seedDir: SEED_DIR, version: "test", warn: () => undefined });
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    stores,
    dataDir,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

type Server = Awaited<ReturnType<typeof startServer>>;

async function postJson<T = unknown>(base: string, url: string, body: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(base + url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as T };
}

async function getJson<T = unknown>(base: string, url: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(base + url, init);
  return { status: res.status, body: (await res.json()) as T };
}

function countBy(questions: Question[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const q of questions) out[q.category] = (out[q.category] ?? 0) + 1;
  return out;
}

async function answer(base: string, sessionId: string, questionId: string, chosen: "A" | "B" | "C") {
  const res = await postJson<AttemptResponse>(base, "/api/attempts", { sessionId, questionId, chosen, inputMode: "tap", responseMs: 1234 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

describe("POST /api/quiz/start", () => {
  let s: Server;
  before(async () => {
    s = await startServer();
  });
  after(() => s.close());

  it("returns the requested number of questions with a fresh session id", async () => {
    const a = await postJson<QuizStartResponse>(s.base, "/api/quiz/start", { count: 5 });
    const b = await postJson<QuizStartResponse>(s.base, "/api/quiz/start", { count: 5 });
    assert.equal(a.status, 200);
    assert.equal(a.body.questions.length, 5);
    assert.ok(a.body.sessionId.length > 10);
    assert.notEqual(a.body.sessionId, b.body.sessionId);
    assert.equal(new Set(a.body.questions.map((q) => q.id)).size, 5, "no duplicates");
  });

  it("clamps count to 1..50 and never returns more than the bank holds", async () => {
    const tooMany = await postJson<QuizStartResponse>(s.base, "/api/quiz/start", { count: 500 });
    assert.equal(tooMany.status, 200);
    assert.equal(tooMany.body.questions.length, 24);
    const tooFew = await postJson<QuizStartResponse>(s.base, "/api/quiz/start", { count: 0 });
    assert.equal(tooFew.body.questions.length, 1);
    const fraction = await postJson<QuizStartResponse>(s.base, "/api/quiz/start", { count: 3.7 });
    assert.equal(fraction.body.questions.length, 3);
  });

  it("validates the body", async () => {
    const missing = await postJson<{ code: string }>(s.base, "/api/quiz/start", {});
    assert.equal(missing.status, 400);
    assert.equal(missing.body.code, "missing_count");
    const badCategory = await postJson<{ code: string }>(s.base, "/api/quiz/start", { count: 3, categories: ["oncology"] });
    assert.equal(badCategory.status, 400);
    assert.equal(badCategory.body.code, "invalid_categories");
    const badFlag = await postJson<{ code: string }>(s.base, "/api/quiz/start", { count: 3, adaptive: "yes" });
    assert.equal(badFlag.status, 400);
    assert.equal(badFlag.body.code, "invalid_adaptive");
  });

  it("restricts to the requested categories, sources and difficulty", async () => {
    const res = await postJson<QuizStartResponse>(s.base, "/api/quiz/start", {
      count: 10,
      categories: ["management_of_care", "physiological_adaptation"],
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.questions.length, 6);
    assert.ok(res.body.questions.every((q) => q.category === "management_of_care" || q.category === "physiological_adaptation"));

    const hard = await postJson<QuizStartResponse>(s.base, "/api/quiz/start", { count: 10, difficulty: ["hard"] });
    assert.ok(hard.body.questions.length > 0);
    assert.ok(hard.body.questions.every((q) => q.difficulty === "hard"));

    const ai = await postJson<{ code: string }>(s.base, "/api/quiz/start", { count: 10, sources: ["ai"] });
    assert.equal(ai.status, 400);
    assert.equal(ai.body.code, "no_questions");
  });

  it("follows the blueprint distribution", async () => {
    // For 8 questions across all categories the largest-remainder split gives one per category.
    const expected = blueprintDistribution(8);
    for (const id of CATEGORY_IDS) assert.equal(expected[id], 1);
    const res = await postJson<QuizStartResponse>(s.base, "/api/quiz/start", { count: 8 });
    assert.equal(res.body.questions.length, 8);
    assert.deepEqual(countBy(res.body.questions), Object.fromEntries(CATEGORY_IDS.map((id) => [id, 1])));

    // A category that is short is filled from the other allowed categories.
    const big = await postJson<QuizStartResponse>(s.base, "/api/quiz/start", { count: 12, categories: ["management_of_care", "safety_and_infection_control", "basic_care_and_comfort"] });
    assert.equal(big.body.questions.length, 9);
  });

  it("interleaves categories instead of grouping them", async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await postJson<QuizStartResponse>(s.base, "/api/quiz/start", { count: 6, categories: ["management_of_care", "safety_and_infection_control"] });
      assert.equal(res.body.questions.length, 6);
      const order = res.body.questions.map((q) => q.category);
      for (let j = 1; j < order.length; j += 1) assert.notEqual(order[j], order[j - 1], `grouped: ${order.join(",")}`);
    }
  });

  it("prefers questions not answered in the last 7 days", async () => {
    const sessionId = "recent-session";
    await answer(s.base, sessionId, "hpm-901", "B");
    await answer(s.base, sessionId, "hpm-902", "A");
    for (let i = 0; i < 5; i += 1) {
      const res = await postJson<QuizStartResponse>(s.base, "/api/quiz/start", { count: 1, categories: ["health_promotion_and_maintenance"] });
      assert.equal(res.body.questions[0]?.id, "hpm-903");
    }
    // Still returns recently answered questions when nothing else is left.
    const all = await postJson<QuizStartResponse>(s.base, "/api/quiz/start", { count: 3, categories: ["health_promotion_and_maintenance"] });
    assert.equal(all.body.questions.length, 3);
    // avoidRecent=false ignores history: over several runs the recent ones show up too.
    const seen = new Set<string>();
    for (let i = 0; i < 40 && seen.size < 3; i += 1) {
      const res = await postJson<QuizStartResponse>(s.base, "/api/quiz/start", { count: 1, categories: ["health_promotion_and_maintenance"], avoidRecent: false });
      seen.add(res.body.questions[0]?.id ?? "");
    }
    assert.equal(seen.size, 3);
  });

  it("shifts the quota toward weak categories when adaptive", async () => {
    const sessionId = "weak-session";
    // Three wrong answers make psychosocial_integrity a weak category (accuracy 0 on 3 attempts).
    await answer(s.base, sessionId, "psi-901", "A");
    await answer(s.base, sessionId, "psi-902", "A");
    await answer(s.base, sessionId, "psi-903", "C");
    const stats = await getJson<Stats>(s.base, "/api/stats");
    assert.deepEqual(stats.body.weakCategories, ["psychosocial_integrity"]);

    // Blueprint gives psychosocial 1 of 10; adaptive mode moves 2 more there (the fixture has 3).
    const adaptive = await postJson<QuizStartResponse>(s.base, "/api/quiz/start", { count: 10 });
    assert.equal(adaptive.body.questions.length, 10);
    assert.equal(countBy(adaptive.body.questions).psychosocial_integrity, 3);

    const plain = await postJson<QuizStartResponse>(s.base, "/api/quiz/start", { count: 10, adaptive: false });
    assert.equal(countBy(plain.body.questions).psychosocial_integrity, 1);
  });
});

describe("selectQuestions (pure)", () => {
  const bank = new QuestionStore({ seedDir: SEED_DIR, dataFile: path.join(os.tmpdir(), "nclex-select-ro", "questions.json"), warn: () => undefined }).all();
  const emptyStats: Stats = { totalAttempted: 0, totalCorrect: 0, accuracy: null, byCategory: [], recentSessions: [], weakCategories: [] };

  it("is deterministic for a fixed random source", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const a = selectQuestions(bank, { count: 8 }, emptyStats, new Set(), random);
    seed = 7;
    const b = selectQuestions(bank, { count: 8 }, emptyStats, new Set(), random);
    assert.deepEqual(a.map((q) => q.id), b.map((q) => q.id));
    assert.equal(a.length, 8);
  });

  it("returns an empty list when nothing matches", () => {
    assert.deepEqual(selectQuestions(bank, { count: 5, sources: ["ai"] }, undefined, new Set()), []);
    assert.deepEqual(selectQuestions([], { count: 5 }, undefined, new Set()), []);
  });

  it("applyAdaptiveShift moves at most 40% and keeps every category at 1", () => {
    const quota = blueprintDistribution(20);
    const shifted = applyAdaptiveShift(quota, ["basic_care_and_comfort", "psychosocial_integrity"]);
    const total = (r: Record<CategoryId, number>) => CATEGORY_IDS.reduce((sum, id) => sum + r[id], 0);
    assert.equal(total(shifted), 20);
    const moved = shifted.basic_care_and_comfort + shifted.psychosocial_integrity - quota.basic_care_and_comfort - quota.psychosocial_integrity;
    assert.ok(moved > 0 && moved <= 8, `moved ${moved}`);
    for (const id of CATEGORY_IDS) assert.ok(shifted[id] >= 1, `${id} dropped to ${shifted[id]}`);
    // Weak categories that are not part of the quiz are ignored.
    const restricted = blueprintDistribution(6, ["management_of_care", "safety_and_infection_control"]);
    assert.deepEqual(applyAdaptiveShift(restricted, ["basic_care_and_comfort"]), restricted);
  });
});

describe("attempts, stats and sessions", () => {
  let s: Server;
  before(async () => {
    s = await startServer();
  });
  after(() => s.close());

  it("grades attempts and stores them", async () => {
    const wrong = await answer(s.base, "sess-1", "moc-901", "B");
    assert.equal(wrong.isCorrect, false);
    assert.equal(wrong.correct, "A");
    assert.equal(wrong.attempt.category, "management_of_care");
    assert.equal(wrong.attempt.responseMs, 1234);
    const right = await answer(s.base, "sess-1", "moc-902", "B");
    assert.equal(right.isCorrect, true);
    assert.equal(s.stores.attempts.list().length, 2);
  });

  it("validates attempt bodies and 404s for unknown questions", async () => {
    const unknown = await postJson<{ code: string }>(s.base, "/api/attempts", { sessionId: "x", questionId: "nope", chosen: "A", inputMode: "voice" });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.code, "question_not_found");
    const badLabel = await postJson<{ code: string }>(s.base, "/api/attempts", { sessionId: "x", questionId: "moc-901", chosen: "D", inputMode: "voice" });
    assert.equal(badLabel.status, 400);
    assert.equal(badLabel.body.code, "invalid_chosen");
    const badMode = await postJson<{ code: string }>(s.base, "/api/attempts", { sessionId: "x", questionId: "moc-901", chosen: "A", inputMode: "telepathy" });
    assert.equal(badMode.status, 400);
    assert.equal(badMode.body.code, "invalid_inputMode");
  });

  it("computes stats, weak categories and recent sessions", async () => {
    // Look the keys up so the test does not depend on which label each fixture happens to use.
    const keyOf = (id: string) => s.stores.questions.get(id)?.correct ?? "A";
    const wrongFor = (id: string) => (keyOf(id) === "A" ? "B" : "A");
    // Session 2: physiological adaptation, 1 of 3 correct -> weak. Session 3: pharmacology 3/3.
    await answer(s.base, "sess-2", "pa-901", keyOf("pa-901"));
    await answer(s.base, "sess-2", "pa-902", wrongFor("pa-902"));
    await answer(s.base, "sess-2", "pa-903", wrongFor("pa-903"));
    await answer(s.base, "sess-3", "ppt-901", keyOf("ppt-901"));
    await answer(s.base, "sess-3", "ppt-902", keyOf("ppt-902"));
    await answer(s.base, "sess-3", "ppt-903", keyOf("ppt-903"));

    const { status, body } = await getJson<Stats>(s.base, "/api/stats");
    assert.equal(status, 200);
    assert.equal(body.totalAttempted, 8);
    assert.equal(body.totalCorrect, 5);
    assert.equal(body.accuracy, 5 / 8);
    assert.equal(body.byCategory.length, 8);
    const pa = body.byCategory.find((c) => c.category === "physiological_adaptation");
    assert.deepEqual(pa, { category: "physiological_adaptation", attempted: 3, correct: 1, accuracy: 1 / 3 });
    const untouched = body.byCategory.find((c) => c.category === "basic_care_and_comfort");
    assert.deepEqual(untouched, { category: "basic_care_and_comfort", attempted: 0, correct: 0, accuracy: null });
    // management_of_care has only 2 attempts, so it is not (yet) weak.
    assert.deepEqual(body.weakCategories, ["physiological_adaptation"]);
    assert.deepEqual(body.recentSessions.map((r) => r.sessionId), ["sess-3", "sess-2", "sess-1"]);
    assert.deepEqual(body.recentSessions[0], { ...body.recentSessions[0], answered: 3, correct: 3 });
  });

  it("orders weak categories worst first and caps recent sessions at 20", () => {
    const attempts: Attempt[] = [];
    const push = (sessionId: string, category: CategoryId, isCorrect: boolean, minute: number) =>
      attempts.push({
        id: `a${attempts.length}`,
        sessionId,
        questionId: "q",
        category,
        chosen: "A",
        correct: isCorrect ? "A" : "B",
        isCorrect,
        answeredAt: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
        inputMode: "tap",
      });
    for (let i = 0; i < 25; i += 1) push(`s${i}`, "management_of_care", true, i);
    push("w", "basic_care_and_comfort", false, 100);
    push("w", "basic_care_and_comfort", false, 101);
    push("w", "basic_care_and_comfort", true, 102);
    push("w", "psychosocial_integrity", false, 103);
    push("w", "psychosocial_integrity", false, 104);
    push("w", "psychosocial_integrity", false, 105);
    push("w", "physiological_adaptation", true, 106);
    push("w", "physiological_adaptation", true, 107);
    push("w", "physiological_adaptation", true, 108);
    const stats = computeStats(attempts);
    assert.deepEqual(stats.weakCategories, ["psychosocial_integrity", "basic_care_and_comfort"]);
    assert.equal(stats.recentSessions.length, 20);
    assert.equal(stats.recentSessions[0]?.sessionId, "w");
    assert.equal(stats.recentSessions[1]?.sessionId, "s24");
    const recent = recentlyAnsweredIds(attempts, 7, Date.UTC(2026, 0, 5));
    assert.deepEqual([...recent], ["q"]);
    assert.equal(recentlyAnsweredIds(attempts, 1, Date.UTC(2026, 0, 5)).size, 0);
  });

  it("returns a session with its summary and 404s for unknown sessions", async () => {
    const { status, body } = await getJson<{ sessionId: string; attempts: Attempt[]; summary: { answered: number; correct: number; startedAt: string } }>(s.base, "/api/sessions/sess-2");
    assert.equal(status, 200);
    assert.equal(body.sessionId, "sess-2");
    assert.equal(body.attempts.length, 3);
    assert.equal(body.summary.answered, 3);
    assert.equal(body.summary.correct, 1);
    assert.equal(body.summary.startedAt, body.attempts[0]?.answeredAt);
    const missing = await getJson<{ code: string }>(s.base, "/api/sessions/none");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, "session_not_found");
  });

  it("DELETE /api/stats clears history", async () => {
    const del = await getJson<{ ok: boolean }>(s.base, "/api/stats", { method: "DELETE" });
    assert.deepEqual(del.body, { ok: true });
    const stats = await getJson<Stats>(s.base, "/api/stats");
    assert.equal(stats.body.totalAttempted, 0);
    assert.equal(stats.body.accuracy, null);
    assert.deepEqual(stats.body.recentSessions, []);
  });
});
