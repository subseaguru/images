import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createApp, errorToResponse } from "../../src/server/app.js";
import { HttpError } from "../../src/server/routes/http.js";
import { PROJECT_ROOT } from "../../src/server/paths.js";
import type { Blueprint, Question } from "../../src/shared/types.js";
import { CATEGORY_IDS } from "../../src/shared/types.js";

const SEED_DIR = path.join(PROJECT_ROOT, "tests", "fixtures", "seed");

async function startServer() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "nclex-api-"));
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

async function json<T = unknown>(base: string, url: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(base + url, init);
  return { status: res.status, body: (await res.json()) as T };
}

function post(body: unknown): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function fixtureQuestion(overrides: Partial<Question> = {}): Record<string, unknown> {
  return {
    stem: "A client with a new prescription for metformin asks how the drug works. Which explanation is correct?",
    options: [
      { label: "A", text: "It decreases hepatic glucose production and improves insulin sensitivity", rationale: "Metformin lowers hepatic glucose output and increases peripheral insulin sensitivity." },
      { label: "B", text: "It stimulates the pancreas to release more insulin", rationale: "Sulfonylureas, not metformin, stimulate insulin release from the pancreas." },
      { label: "C", text: "It replaces the insulin the pancreas no longer makes", rationale: "Metformin is not insulin and does not replace it." },
    ],
    correct: "A",
    category: "pharmacological_and_parenteral_therapies",
    subtopic: "Expected Actions/Outcomes",
    difficulty: "easy",
    ...overrides,
  };
}

describe("health and blueprint", () => {
  let s: Server;
  before(async () => {
    s = await startServer();
  });
  after(() => s.close());

  it("GET /api/health reports the bank size and key status", async () => {
    const { status, body } = await json<{ ok: boolean; version: string; hasApiKey: boolean; questionCount: number }>(s.base, "/api/health");
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, version: "test", hasApiKey: false, questionCount: 24 });
  });

  it("GET /api/blueprint returns the NCLEX-RN blueprint", async () => {
    const { status, body } = await json<Blueprint>(s.base, "/api/blueprint");
    assert.equal(status, 200);
    assert.equal(body.name, "NCLEX-RN Test Plan");
    assert.equal(body.categories.length, 8);
    assert.deepEqual(body.categories.map((c) => c.id), [...CATEGORY_IDS]);
    assert.equal(body.clinicalJudgmentSteps.length, 6);
  });

  it("unknown /api paths return JSON 404", async () => {
    const { status, body } = await json<{ error: string; code: string }>(s.base, "/api/nope");
    assert.equal(status, 404);
    assert.equal(body.code, "not_found");
  });

  it("malformed JSON bodies return 400 invalid_json", async () => {
    const res = await fetch(s.base + "/api/quiz/start", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { code: string };
    assert.equal(body.code, "invalid_json");
  });
});

describe("questions", () => {
  let s: Server;
  before(async () => {
    s = await startServer();
  });
  after(() => s.close());

  it("lists the whole bank with counts", async () => {
    const { status, body } = await json<{ questions: Question[]; counts: { total: number; bySource: Record<string, number>; byCategory: Record<string, number> } }>(s.base, "/api/questions");
    assert.equal(status, 200);
    assert.equal(body.questions.length, 24);
    assert.equal(body.counts.total, 24);
    assert.deepEqual(body.counts.bySource, { bundled: 24, ai: 0, imported: 0 });
    for (const id of CATEGORY_IDS) assert.equal(body.counts.byCategory[id], 3);
  });

  it("filters by repeated category, difficulty and text search; counts stay unfiltered", async () => {
    const { body } = await json<{ questions: Question[]; counts: { total: number } }>(
      s.base,
      "/api/questions?category=management_of_care&category=physiological_adaptation",
    );
    assert.equal(body.questions.length, 6);
    assert.ok(body.questions.every((q) => q.category === "management_of_care" || q.category === "physiological_adaptation"));
    assert.equal(body.counts.total, 24);

    const hard = await json<{ questions: Question[] }>(s.base, "/api/questions?difficulty=hard");
    assert.ok(hard.body.questions.length > 0);
    assert.ok(hard.body.questions.every((q) => q.difficulty === "hard"));

    const search = await json<{ questions: Question[] }>(s.base, "/api/questions?q=APGAR");
    assert.equal(search.body.questions.length, 1);
    assert.equal(search.body.questions[0]?.id, "hpm-901");

    const source = await json<{ questions: Question[] }>(s.base, "/api/questions?source=ai");
    assert.equal(source.body.questions.length, 0);
  });

  it("rejects unknown filter values with 400", async () => {
    const { status, body } = await json<{ code: string }>(s.base, "/api/questions?category=cardiology");
    assert.equal(status, 400);
    assert.equal(body.code, "invalid_category");
  });

  it("gets a single question and 404s for unknown ids", async () => {
    const found = await json<Question>(s.base, "/api/questions/moc-901");
    assert.equal(found.status, 200);
    assert.equal(found.body.id, "moc-901");
    assert.equal(found.body.options.length, 3);
    const missing = await json<{ code: string }>(s.base, "/api/questions/nope-999");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, "question_not_found");
  });

  it("imports valid questions, reports rejected ones and re-mints taken ids", async () => {
    const payload = {
      version: 1,
      questions: [
        fixtureQuestion({ id: "moc-901" }),
        fixtureQuestion({ id: "custom-1", source: "ai" as const, createdAt: "2025-01-01T00:00:00.000Z" }),
        { ...fixtureQuestion(), correct: "D" },
        "not an object",
      ],
    };
    const { status, body } = await json<{ imported: number; rejected: { index: number; errors: string[] }[] }>(
      s.base,
      "/api/questions/import",
      post(payload),
    );
    assert.equal(status, 200);
    assert.equal(body.imported, 2);
    assert.deepEqual(body.rejected.map((r) => r.index), [2, 3]);
    assert.ok(body.rejected[0]?.errors.some((e) => e.includes("correct")));

    const list = await json<{ questions: Question[]; counts: { bySource: Record<string, number> } }>(s.base, "/api/questions?source=imported");
    assert.equal(list.body.questions.length, 2);
    assert.equal(list.body.counts.bySource.imported, 2);
    assert.ok(list.body.questions.every((q) => q.source === "imported"));
    const remint = list.body.questions.find((q) => q.stem.startsWith("A client with a new prescription") && q.id !== "custom-1");
    assert.ok(remint, "the question that reused moc-901 got a fresh id");
    assert.notEqual(remint.id, "moc-901");
    assert.ok(typeof remint.createdAt === "string" && !Number.isNaN(Date.parse(remint.createdAt)));
    const kept = list.body.questions.find((q) => q.id === "custom-1");
    assert.ok(kept);
    assert.equal(kept.createdAt, "2025-01-01T00:00:00.000Z");
    // Bundled question is untouched.
    const original = await json<Question>(s.base, "/api/questions/moc-901");
    assert.equal(original.body.source, "bundled");

    // Persisted to questions.json.
    const saved = JSON.parse(await readFile(path.join(s.dataDir, "questions.json"), "utf8")) as { version: number; questions: Question[] };
    assert.equal(saved.version, 1);
    assert.equal(saved.questions.length, 2);
  });

  it("accepts { questions: [...] } without a version and rejects other shapes", async () => {
    const ok = await json<{ imported: number }>(s.base, "/api/questions/import", post({ questions: [fixtureQuestion()] }));
    assert.equal(ok.status, 200);
    assert.equal(ok.body.imported, 1);
    const bad = await json<{ code: string }>(s.base, "/api/questions/import", post({ foo: 1 }));
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, "invalid_import");
  });

  it("deletes imported questions but never bundled ones", async () => {
    const bundled = await json<{ code: string }>(s.base, "/api/questions/moc-901", { method: "DELETE" });
    assert.equal(bundled.status, 400);
    assert.equal(bundled.body.code, "bundled_question");

    const imported = await json<{ questions: Question[] }>(s.base, "/api/questions?source=imported");
    const target = imported.body.questions[0];
    assert.ok(target);
    const del = await json<{ ok: boolean }>(s.base, `/api/questions/${target.id}`, { method: "DELETE" });
    assert.equal(del.status, 200);
    assert.deepEqual(del.body, { ok: true });
    const gone = await json(s.base, `/api/questions/${target.id}`);
    assert.equal(gone.status, 404);
    const again = await json<{ code: string }>(s.base, `/api/questions/${target.id}`, { method: "DELETE" });
    assert.equal(again.status, 404);
  });

  it("reloads persisted questions on restart", async () => {
    const before = s.stores.questions.counts().bySource.imported;
    const { stores } = createApp({ dataDir: s.dataDir, seedDir: SEED_DIR, version: "test", warn: () => undefined });
    assert.equal(stores.questions.counts().bySource.imported, before);
    assert.equal(stores.questions.counts().total, 24 + before);
  });
});

describe("static site and error handling", () => {
  let s: Server;
  before(async () => {
    s = await startServer();
  });
  after(() => s.close());

  it("serves index.html for / and for unknown non-API paths (SPA fallback)", async () => {
    const root = await fetch(s.base + "/");
    assert.equal(root.status, 200);
    assert.match(root.headers.get("content-type") ?? "", /text\/html/);
    const html = await root.text();
    assert.match(html, /<!doctype html>/i);
    const deep = await fetch(s.base + "/quiz/session/abc");
    assert.equal(deep.status, 200);
    assert.equal(await deep.text(), html);
    // API paths never fall through to the page.
    const api = await fetch(s.base + "/api/quiz/session/abc");
    assert.equal(api.status, 404);
    assert.match(api.headers.get("content-type") ?? "", /application\/json/);
  });

  it("does not cache API responses or advertise the framework", async () => {
    const res = await fetch(s.base + "/api/health");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("x-powered-by"), null);
  });

  it("errorToResponse hides details of unexpected errors and keeps typed ones", () => {
    const crash = errorToResponse(new Error("ENOENT: secret path /home/user/data"));
    assert.deepEqual(crash, { status: 500, body: { error: "Internal server error.", code: "internal_error" }, exposed: false });
    assert.equal(errorToResponse("a string").status, 500);
    assert.equal(errorToResponse(undefined).body.code, "internal_error");
    // A 5xx we raised on purpose (e.g. an upstream fetch failure) keeps its message and code.
    const upstream = errorToResponse(new HttpError(502, "Could not fetch https://x: HTTP 500", "fetch_failed"));
    assert.deepEqual(upstream, { status: 502, body: { error: "Could not fetch https://x: HTTP 500", code: "fetch_failed" }, exposed: true });
    // Body-parser errors are translated to our codes.
    const big = errorToResponse(Object.assign(new Error("request entity too large"), { status: 413, type: "entity.too.large", expose: true }));
    assert.deepEqual(big.body, { error: "request entity too large", code: "payload_too_large" });
    // Out-of-range statuses collapse to 500.
    assert.equal(errorToResponse(Object.assign(new Error("x"), { status: 999 })).status, 500);
  });
});
