/**
 * Express application factory (docs/API.md). Stores load synchronously from `dataDir`, so the
 * returned app is ready to `listen` immediately; the generator is injectable for tests.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import express from "express";
import type { ErrorRequestHandler, Express, NextFunction, Request, Response } from "express";
import { generateQuestions, verifyApiKey } from "./generator/index.js";
import { PUBLIC_DIR } from "./paths.js";
import { QuestionStore } from "./questions/store.js";
import { AttemptStore } from "./quiz/progress.js";
import { generateRouter } from "./routes/generate.js";
import { healthRouter } from "./routes/health.js";
import { questionsRouter } from "./routes/questions.js";
import { quizRouter } from "./routes/quiz.js";
import { settingsRouter } from "./routes/settings.js";
import { sourcesRouter } from "./routes/sources.js";
import { SettingsStore } from "./settings.js";
import { SourceStore } from "./sources/store.js";
import { ensureDirSync } from "./storage/jsonFile.js";

export interface Generator {
  generateQuestions: typeof generateQuestions;
  verifyApiKey: typeof verifyApiKey;
}

export interface AppOptions {
  dataDir: string;
  seedDir: string;
  version: string;
  envApiKey?: string;
  generator?: Generator;
  /** Fetch used by `POST /api/sources/url` (tests inject a fake). */
  fetchImpl?: typeof globalThis.fetch;
  /** Where store warnings go (defaults to console.warn). */
  warn?: (message: string) => void;
}

export interface AppStores {
  questions: QuestionStore;
  attempts: AttemptStore;
  sources: SourceStore;
  settings: SettingsStore;
}

export const JSON_BODY_LIMIT = "5mb";

interface ErrorLike {
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
  type?: unknown;
  message?: unknown;
  /** Set by our own typed errors (and by http-errors) when the message is safe to show. */
  expose?: unknown;
}

/** Body-parser failures carry a `type` instead of a code we would choose ourselves. */
const BODY_PARSER_CODES: Record<string, string> = {
  "entity.parse.failed": "invalid_json",
  "entity.too.large": "payload_too_large",
  "encoding.unsupported": "unsupported_encoding",
  "charset.unsupported": "unsupported_charset",
  "request.aborted": "request_aborted",
};

/**
 * Turns anything thrown by a route into `{ status, body }`. Messages are only forwarded for
 * errors that opt in (`expose`, as set by our typed errors and the body parser) or that are
 * plain 4xx; anything else is an unexpected failure and stays a generic 500 with no details.
 */
export function errorToResponse(err: unknown): {
  status: number;
  body: { error: string; code: string };
  exposed: boolean;
} {
  const e = (typeof err === "object" && err !== null ? err : {}) as ErrorLike;
  const rawStatus = typeof e.status === "number" ? e.status : typeof e.statusCode === "number" ? e.statusCode : 500;
  const status = rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500;
  const exposed = e.expose === true || status < 500;
  const parserCode = typeof e.type === "string" ? BODY_PARSER_CODES[e.type] : undefined;
  const fallbackCode = status < 500 ? "bad_request" : "internal_error";
  const code = parserCode ?? (exposed && typeof e.code === "string" && e.code ? e.code : fallbackCode);
  const message =
    exposed && typeof e.message === "string" && e.message
      ? e.message
      : status < 500
        ? "Bad request."
        : "Internal server error.";
  return { status, body: { error: message, code }, exposed };
}

export function createApp(options: AppOptions): { app: Express; stores: AppStores } {
  const warn = options.warn ?? ((message: string) => console.warn(message));
  ensureDirSync(options.dataDir);
  const stores: AppStores = {
    questions: new QuestionStore({
      seedDir: options.seedDir,
      dataFile: path.join(options.dataDir, "questions.json"),
      warn,
    }),
    attempts: new AttemptStore(path.join(options.dataDir, "attempts.json"), warn),
    sources: new SourceStore(path.join(options.dataDir, "sources"), warn),
    settings: new SettingsStore(path.join(options.dataDir, "settings.json"), warn),
  };
  const generator: Generator = options.generator ?? { generateQuestions, verifyApiKey };
  const envApiKey = options.envApiKey?.trim() || undefined;

  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);

  const api = express.Router();
  const jsonParser = express.json({ limit: JSON_BODY_LIMIT });
  // Raw uploads must reach express.raw untouched even when a client labels them as JSON.
  api.use((req, res, next) => {
    if (req.path.startsWith("/sources/upload")) return next();
    return jsonParser(req, res, next);
  });
  api.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  api.use(healthRouter({ version: options.version, envApiKey, questions: stores.questions, settings: stores.settings }));
  api.use(questionsRouter({ questions: stores.questions }));
  api.use(quizRouter({ questions: stores.questions, attempts: stores.attempts }));
  api.use(sourcesRouter({ sources: stores.sources, fetchImpl: options.fetchImpl }));
  api.use(settingsRouter({ settings: stores.settings, envApiKey, verifyApiKey: generator.verifyApiKey }));
  api.use(
    generateRouter({
      questions: stores.questions,
      attempts: stores.attempts,
      sources: stores.sources,
      settings: stores.settings,
      envApiKey,
      generateQuestions: generator.generateQuestions,
    }),
  );
  api.use((req, res) => {
    res.status(404).json({ error: `No API route for ${req.method} /api${req.path}`, code: "not_found" });
  });
  app.use("/api", api);

  app.use(express.static(PUBLIC_DIR, { index: "index.html", extensions: ["html"] }));

  const indexHtml = path.join(PUBLIC_DIR, "index.html");
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (!existsSync(indexHtml)) {
      res.status(404).type("text/plain").send("public/index.html is missing; run npm run build.");
      return;
    }
    res.sendFile(indexHtml);
  });

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    const { status, body, exposed } = errorToResponse(err);
    if (!exposed) console.error("Unexpected error:", err);
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(status).json(body);
  };
  app.use(errorHandler);

  return { app, stores };
}
