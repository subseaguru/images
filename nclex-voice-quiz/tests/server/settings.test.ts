import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createApp, type Generator } from "../../src/server/app.js";
import { GeneratorError } from "../../src/server/generator/index.js";
import { PROJECT_ROOT } from "../../src/server/paths.js";
import { apiKeyHint } from "../../src/server/settings.js";
import type { Settings } from "../../src/shared/types.js";

const SEED_DIR = path.join(PROJECT_ROOT, "tests", "fixtures", "seed");

async function startServer(options: { envApiKey?: string; generator?: Partial<Generator> } = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "nclex-settings-"));
  const { app, stores } = createApp({ dataDir, seedDir: SEED_DIR, version: "test", warn: () => undefined, ...options });
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

async function call<T = unknown>(base: string, url: string, method = "GET", body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(base + url, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

const DEFAULTS: Settings = {
  model: "claude-opus-5",
  hasApiKey: false,
  apiKeyFromEnv: false,
  voice: { enabled: true, rate: 1, autoListen: true, readRationale: true },
  defaultCount: 10,
};

describe("/api/settings", () => {
  let s: Server;
  const verifyCalls: { apiKey: string; model: string }[] = [];
  const generator: Partial<Generator> = {
    generateQuestions: async () => {
      throw new GeneratorError("unused", 500);
    },
    verifyApiKey: async (apiKey, model) => {
      verifyCalls.push({ apiKey, model });
      return apiKey.endsWith("good") ? { ok: true } : { ok: false, error: "Invalid key" };
    },
  };
  before(async () => {
    s = await startServer({ generator });
  });
  after(() => s.close());

  it("returns the defaults", async () => {
    const { status, body } = await call<Settings>(s.base, "/api/settings");
    assert.equal(status, 200);
    assert.deepEqual(body, DEFAULTS);
  });

  it("merges partial updates and persists them", async () => {
    const { status, body } = await call<Settings>(s.base, "/api/settings", "PUT", { voice: { rate: 1.5, voiceName: "Samantha" }, defaultCount: 15, ignored: true });
    assert.equal(status, 200);
    assert.deepEqual(body, {
      ...DEFAULTS,
      voice: { enabled: true, rate: 1.5, voiceName: "Samantha", autoListen: true, readRationale: true },
      defaultCount: 15,
    });
    const second = await call<Settings>(s.base, "/api/settings", "PUT", { model: " claude-sonnet-5 ", voice: { enabled: false, voiceName: null } });
    assert.equal(second.body.model, "claude-sonnet-5");
    assert.equal(second.body.voice.enabled, false);
    assert.equal(second.body.voice.rate, 1.5);
    assert.equal("voiceName" in second.body.voice, false);
    assert.equal(second.body.defaultCount, 15);

    const saved = JSON.parse(await readFile(path.join(s.dataDir, "settings.json"), "utf8")) as Record<string, unknown>;
    assert.equal(saved.model, "claude-sonnet-5");
    assert.equal(saved.defaultCount, 15);
    const reloaded = createApp({ dataDir: s.dataDir, seedDir: SEED_DIR, version: "test", warn: () => undefined }).stores.settings.toPublicSettings();
    assert.equal(reloaded.model, "claude-sonnet-5");
    assert.equal(reloaded.voice.rate, 1.5);
  });

  it("rejects out-of-range or mistyped values", async () => {
    const rate = await call<{ code: string }>(s.base, "/api/settings", "PUT", { voice: { rate: 3 } });
    assert.equal(rate.status, 400);
    assert.equal(rate.body.code, "invalid_voice.rate");
    const count = await call<{ code: string }>(s.base, "/api/settings", "PUT", { defaultCount: 0 });
    assert.equal(count.status, 400);
    const model = await call<{ code: string }>(s.base, "/api/settings", "PUT", { model: "" });
    assert.equal(model.status, 400);
    assert.equal(model.body.code, "invalid_model");
    const voice = await call<{ code: string }>(s.base, "/api/settings", "PUT", { voice: "loud" });
    assert.equal(voice.status, 400);
    const enabled = await call<{ code: string }>(s.base, "/api/settings", "PUT", { voice: { enabled: "yes" } });
    assert.equal(enabled.status, 400);
  });

  it("stores the API key, exposes only a hint and never returns the key", async () => {
    const key = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz7f2a";
    const { status, body } = await call<Settings>(s.base, "/api/settings/api-key", "PUT", { apiKey: `  ${key}  ` });
    assert.equal(status, 200);
    assert.equal(body.hasApiKey, true);
    assert.equal(body.apiKeyFromEnv, false);
    assert.equal(body.apiKeyHint, "sk-ant-…7f2a");
    assert.ok(!JSON.stringify(body).includes("abcdefghij"));
    const health = await call<{ hasApiKey: boolean }>(s.base, "/api/health");
    assert.equal(health.body.hasApiKey, true);
    const saved = JSON.parse(await readFile(path.join(s.dataDir, "settings.json"), "utf8")) as { apiKey?: string };
    assert.equal(saved.apiKey, key);

    const empty = await call<{ code: string }>(s.base, "/api/settings/api-key", "PUT", { apiKey: "   " });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.code, "missing_apiKey");
  });

  it("verifies the effective key through the generator", async () => {
    const bad = await call<{ ok: boolean; error?: string; model: string }>(s.base, "/api/settings/verify-key", "POST");
    assert.equal(bad.status, 200);
    assert.deepEqual(bad.body, { ok: false, error: "Invalid key", model: "claude-sonnet-5" });
    await call(s.base, "/api/settings/api-key", "PUT", { apiKey: "sk-ant-key-that-is-good" });
    const good = await call<{ ok: boolean; model: string }>(s.base, "/api/settings/verify-key", "POST");
    assert.deepEqual(good.body, { ok: true, model: "claude-sonnet-5" });
    assert.equal(verifyCalls.at(-1)?.apiKey, "sk-ant-key-that-is-good");
  });

  it("removes the key", async () => {
    const { body } = await call<Settings>(s.base, "/api/settings/api-key", "DELETE");
    assert.equal(body.hasApiKey, false);
    assert.equal("apiKeyHint" in body, false);
    const saved = JSON.parse(await readFile(path.join(s.dataDir, "settings.json"), "utf8")) as { apiKey?: string };
    assert.equal("apiKey" in saved, false);
    const verify = await call<{ ok: boolean; error?: string }>(s.base, "/api/settings/verify-key", "POST");
    assert.equal(verify.body.ok, false);
    assert.match(verify.body.error ?? "", /No API key/);
  });

  it("apiKeyHint masks short keys too", () => {
    assert.equal(apiKeyHint("sk-ant-api03-abcdefghijklmnopqrstuvwxyz7f2a"), "sk-ant-…7f2a");
    assert.equal(apiKeyHint("short"), "sho…");
  });
});

describe("/api/settings with ANTHROPIC_API_KEY in the environment", () => {
  let s: Server;
  before(async () => {
    s = await startServer({ envApiKey: "sk-ant-env-key-0000000000000000-9zz1" });
  });
  after(() => s.close());

  it("reports the env key and refuses to overwrite it", async () => {
    const { body } = await call<Settings>(s.base, "/api/settings");
    assert.equal(body.hasApiKey, true);
    assert.equal(body.apiKeyFromEnv, true);
    assert.equal(body.apiKeyHint, "sk-ant-…9zz1");
    const put = await call<{ code: string }>(s.base, "/api/settings/api-key", "PUT", { apiKey: "sk-ant-other" });
    assert.equal(put.status, 409);
    assert.equal(put.body.code, "api_key_from_env");
    const health = await call<{ hasApiKey: boolean }>(s.base, "/api/health");
    assert.equal(health.body.hasApiKey, true);
  });

  it("the env key wins over a saved key", async () => {
    await s.stores.settings.setApiKey("sk-ant-saved-key-0000000000000-1234");
    assert.equal(s.stores.settings.effectiveApiKey("sk-ant-env-key-0000000000000000-9zz1"), "sk-ant-env-key-0000000000000000-9zz1");
    const { body } = await call<Settings>(s.base, "/api/settings");
    assert.equal(body.apiKeyHint, "sk-ant-…9zz1");
    assert.equal(body.apiKeyFromEnv, true);
  });
});
