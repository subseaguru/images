import { Router } from "express";
import { NCLEX_RN_BLUEPRINT } from "../../shared/blueprint.js";
import type { QuestionStore } from "../questions/store.js";
import type { SettingsStore } from "../settings.js";

export function healthRouter(deps: {
  version: string;
  envApiKey?: string;
  questions: QuestionStore;
  settings: SettingsStore;
}): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      version: deps.version,
      hasApiKey: Boolean(deps.settings.effectiveApiKey(deps.envApiKey)),
      questionCount: deps.questions.size(),
    });
  });

  router.get("/blueprint", (_req, res) => {
    res.json(NCLEX_RN_BLUEPRINT);
  });

  return router;
}
