/**
 * Persisted settings (`settings.json`). The saved API key lives here too and is never sent to
 * the browser: `toPublicSettings` reduces it to a boolean plus a masked hint.
 */
import type { Settings, VoiceSettings } from "../shared/types.js";
import { JsonFile } from "./storage/jsonFile.js";

export interface StoredSettings {
  version: 1;
  model: string;
  voice: VoiceSettings;
  defaultCount: number;
  apiKey?: string;
}

export interface SettingsPatch {
  model?: string;
  voice?: Partial<VoiceSettings>;
  defaultCount?: number;
}

export const DEFAULT_MODEL = "claude-opus-5";
export const DEFAULT_VOICE: VoiceSettings = { enabled: true, rate: 1, autoListen: true, readRationale: true };
export const DEFAULT_COUNT = 10;

export function defaultSettings(): StoredSettings {
  return { version: 1, model: DEFAULT_MODEL, voice: { ...DEFAULT_VOICE }, defaultCount: DEFAULT_COUNT };
}

export function apiKeyHint(key: string): string {
  if (key.length <= 11) return key.slice(0, 3) + "…";
  return key.slice(0, 7) + "…" + key.slice(-4);
}

export class SettingsStore {
  private settings: StoredSettings;
  private readonly file: JsonFile<StoredSettings>;

  constructor(filePath: string, warn: (message: string) => void = (m) => console.warn(m)) {
    this.file = new JsonFile<StoredSettings>(filePath, defaultSettings);
    let loaded: Partial<StoredSettings> = {};
    try {
      loaded = this.file.loadSync();
    } catch (err) {
      warn(`Could not read ${filePath} (${(err as Error).message}); using default settings.`);
    }
    // Merge over the defaults so a settings file from an older version still has every field.
    const base = defaultSettings();
    this.settings = {
      version: 1,
      model: typeof loaded.model === "string" && loaded.model.trim() ? loaded.model.trim() : base.model,
      voice: { ...base.voice, ...(typeof loaded.voice === "object" && loaded.voice ? loaded.voice : {}) },
      defaultCount:
        typeof loaded.defaultCount === "number" && Number.isFinite(loaded.defaultCount)
          ? loaded.defaultCount
          : base.defaultCount,
    };
    if (typeof loaded.apiKey === "string" && loaded.apiKey.trim()) this.settings.apiKey = loaded.apiKey.trim();
  }

  get(): StoredSettings {
    return { ...this.settings, voice: { ...this.settings.voice } };
  }

  get model(): string {
    return this.settings.model;
  }

  get savedApiKey(): string | undefined {
    return this.settings.apiKey;
  }

  /** The environment variable wins over the saved key. */
  effectiveApiKey(envApiKey?: string): string | undefined {
    const env = envApiKey?.trim();
    if (env) return env;
    return this.settings.apiKey;
  }

  async update(patch: SettingsPatch): Promise<void> {
    if (patch.model !== undefined) this.settings.model = patch.model;
    if (patch.defaultCount !== undefined) this.settings.defaultCount = patch.defaultCount;
    if (patch.voice) {
      const voice: VoiceSettings = { ...this.settings.voice, ...patch.voice };
      if (voice.voiceName === undefined) delete voice.voiceName;
      this.settings.voice = voice;
    }
    await this.persist();
  }

  async setApiKey(apiKey: string): Promise<void> {
    this.settings.apiKey = apiKey.trim();
    await this.persist();
  }

  async removeApiKey(): Promise<void> {
    delete this.settings.apiKey;
    await this.persist();
  }

  toPublicSettings(envApiKey?: string): Settings {
    const env = envApiKey?.trim();
    const key = env || this.settings.apiKey;
    const result: Settings = {
      model: this.settings.model,
      hasApiKey: Boolean(key),
      apiKeyFromEnv: Boolean(env),
      voice: { ...this.settings.voice },
      defaultCount: this.settings.defaultCount,
    };
    if (key) result.apiKeyHint = apiKeyHint(key);
    return result;
  }

  private persist(): Promise<void> {
    return this.file.save(this.settings);
  }
}
