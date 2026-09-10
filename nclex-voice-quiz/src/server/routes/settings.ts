import { Router } from "express";
import type { VoiceSettings } from "../../shared/types.js";
import type { verifyApiKey } from "../generator/index.js";
import type { SettingsPatch, SettingsStore } from "../settings.js";
import {
  badRequest,
  bodyObject,
  HttpError,
  isRecord,
  optionalBoolean,
  optionalNumber,
  optionalString,
  requiredString,
} from "./http.js";

export const MIN_VOICE_RATE = 0.5;
export const MAX_VOICE_RATE = 2;
export const MAX_DEFAULT_COUNT = 50;

function parseVoicePatch(value: unknown): Partial<VoiceSettings> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw badRequest("voice must be an object.", "invalid_voice");
  const patch: Partial<VoiceSettings> = {};
  const enabled = optionalBoolean(value.enabled, "voice.enabled");
  const rate = optionalNumber(value.rate, "voice.rate", MIN_VOICE_RATE, MAX_VOICE_RATE);
  const autoListen = optionalBoolean(value.autoListen, "voice.autoListen");
  const readRationale = optionalBoolean(value.readRationale, "voice.readRationale");
  if (enabled !== undefined) patch.enabled = enabled;
  if (rate !== undefined) patch.rate = rate;
  if (autoListen !== undefined) patch.autoListen = autoListen;
  if (readRationale !== undefined) patch.readRationale = readRationale;
  if ("voiceName" in value) {
    // null or "" clears the preferred voice (falls back to the browser default).
    const voiceName = optionalString(value.voiceName, "voice.voiceName", 200);
    patch.voiceName = voiceName || undefined;
  }
  return patch;
}

export function settingsRouter(deps: {
  settings: SettingsStore;
  envApiKey?: string;
  verifyApiKey: typeof verifyApiKey;
}): Router {
  const router = Router();
  const { settings } = deps;
  const publicSettings = () => settings.toPublicSettings(deps.envApiKey);

  router.get("/settings", (_req, res) => {
    res.json(publicSettings());
  });

  router.put("/settings", async (req, res) => {
    const body = bodyObject(req);
    const patch: SettingsPatch = {};
    const model = optionalString(body.model, "model", 200);
    if (body.model !== undefined && body.model !== null && !model) throw badRequest("model cannot be empty.", "invalid_model");
    const defaultCount = optionalNumber(body.defaultCount, "defaultCount", 1, MAX_DEFAULT_COUNT);
    const voice = parseVoicePatch(body.voice);
    if (model) patch.model = model;
    if (defaultCount !== undefined) patch.defaultCount = Math.round(defaultCount);
    if (voice) patch.voice = voice;
    await settings.update(patch);
    res.json(publicSettings());
  });

  router.put("/settings/api-key", async (req, res) => {
    if (deps.envApiKey?.trim()) {
      throw new HttpError(
        409,
        "The API key comes from the ANTHROPIC_API_KEY environment variable and cannot be changed here.",
        "api_key_from_env",
      );
    }
    const body = bodyObject(req);
    const apiKey = requiredString(body.apiKey, "apiKey", 1000);
    await settings.setApiKey(apiKey);
    res.json(publicSettings());
  });

  router.delete("/settings/api-key", async (_req, res) => {
    await settings.removeApiKey();
    res.json(publicSettings());
  });

  router.post("/settings/verify-key", async (_req, res) => {
    const model = settings.model;
    const apiKey = settings.effectiveApiKey(deps.envApiKey);
    if (!apiKey) {
      res.json({ ok: false, error: "No API key is configured. Add one in Settings first.", model });
      return;
    }
    const result = await deps.verifyApiKey(apiKey, model);
    res.json({ ok: result.ok, ...(result.error ? { error: result.error } : {}), model });
  });

  return router;
}
