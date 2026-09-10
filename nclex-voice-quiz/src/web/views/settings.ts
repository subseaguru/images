/**
 * Settings: API key, model, voice preferences, default count and clearing progress.
 */
import type { Settings } from "../../shared/types.js";
import { api, errorMessage } from "../api.js";
import type { Dispose } from "../router.js";
import * as speech from "../speech.js";
import * as state from "../state.js";
import { append, button, checkbox, clear, el, field, statusBox } from "../ui.js";

export function settingsView(root: HTMLElement): Dispose {
  let disposed = false;
  const view = el("div", { class: "view stack" }, el("h1", { text: "Settings" }));
  root.appendChild(view);
  const loading = el("p", { class: "muted", text: "Loading…" });
  view.appendChild(loading);
  let unsubscribeVoices: () => void = () => {};

  state.loadSettings(true).then((settings) => {
    if (disposed) return;
    loading.remove();
    render(settings);
  });

  function render(initial: Settings): void {
    let settings = initial;
    const status = statusBox("settings-status");

    // --- API key ---------------------------------------------------------------------------
    const keyInput = el("input", { testid: "settings-api-key", attrs: { type: "password", placeholder: "sk-ant-…", autocomplete: "off" } });
    const keyInfo = el("p", { class: "muted small", testid: "settings-key-info" });
    const saveKey = button("Save key", () => {
      if (keyInput.value.trim() === "") {
        status.set("error", "Enter an API key first.");
        return;
      }
      runKey(() => api.saveApiKey(keyInput.value.trim()), "API key saved.");
    }, { class: "primary", testid: "settings-save-key" });
    const removeKey = button("Remove key", () => runKey(() => api.removeApiKey(), "API key removed."), { class: "danger", testid: "settings-remove-key" });
    const verifyKey = button("Verify key", () => verify(), { testid: "settings-verify-key" });
    const keyCard = el(
      "section",
      { class: "card" },
      el("h2", { text: "Anthropic API key" }),
      el("p", { class: "muted small", text: "Needed only for generating questions. Stored in data/settings.json on this computer and never sent anywhere except api.anthropic.com." }),
      keyInfo,
      field("API key", keyInput),
      el("div", { class: "row" }, saveKey, removeKey, verifyKey),
    );

    function refreshKeyInfo(): void {
      if (settings.apiKeyFromEnv) {
        keyInfo.textContent = `The key comes from the ANTHROPIC_API_KEY environment variable${settings.apiKeyHint ? ` (${settings.apiKeyHint})` : ""} and is read-only here; unset the variable to manage it from this page.`;
        keyInput.disabled = true;
        saveKey.disabled = true;
        removeKey.disabled = true;
      } else if (settings.hasApiKey) {
        keyInfo.textContent = `A key is saved${settings.apiKeyHint ? ` (${settings.apiKeyHint})` : ""}. Enter a new one to replace it.`;
        keyInput.disabled = false;
        saveKey.disabled = false;
        removeKey.disabled = false;
      } else {
        keyInfo.textContent = "No key saved.";
        keyInput.disabled = false;
        saveKey.disabled = false;
        removeKey.disabled = true;
      }
      verifyKey.disabled = !settings.hasApiKey;
    }

    async function runKey(action: () => Promise<Settings>, message: string): Promise<void> {
      try {
        settings = await action();
        if (disposed) return;
        state.setSettings(settings);
        keyInput.value = "";
        refreshKeyInfo();
        status.set("success", message);
      } catch (error) {
        if (!disposed) status.set("error", errorMessage(error));
      }
    }

    async function verify(): Promise<void> {
      verifyKey.disabled = true;
      status.set("info", "Contacting Anthropic…");
      try {
        const result = await api.verifyApiKey();
        if (disposed) return;
        if (result.ok) status.set("success", `The key works with ${result.model}.`);
        else status.set("error", `Verification failed: ${result.error ?? "unknown error"} (model ${result.model}).`);
      } catch (error) {
        if (!disposed) status.set("error", errorMessage(error));
      } finally {
        verifyKey.disabled = !settings.hasApiKey;
      }
    }

    // --- Model, voice, default count -------------------------------------------------------
    const model = el("input", { testid: "settings-model", attrs: { type: "text", placeholder: "claude-opus-5" } });
    model.value = settings.model;
    const defaultCount = el("input", { testid: "settings-default-count", attrs: { type: "number", min: "1", max: "50" } });
    defaultCount.value = String(settings.defaultCount);

    const enabled = checkbox("Read questions and feedback aloud", { checked: settings.voice.enabled, testid: "settings-voice-enabled" });
    const autoListen = checkbox("Listen for a spoken answer after each question", { checked: settings.voice.autoListen, testid: "settings-voice-autolisten" });
    const readRationale = checkbox("Read the rationale after answering", { checked: settings.voice.readRationale, testid: "settings-voice-rationale" });
    const rate = el("input", { testid: "settings-voice-rate", attrs: { type: "range", min: "0.5", max: "2", step: "0.1" } });
    rate.value = String(settings.voice.rate);
    const rateValue = el("span", { class: "muted", text: `${settings.voice.rate.toFixed(1)}×` });
    rate.addEventListener("input", () => {
      rateValue.textContent = `${Number(rate.value).toFixed(1)}×`;
    });
    const voiceSelect = el("select", { testid: "settings-voice-name" });
    const fillVoices = () => {
      const voices = speech.getVoices();
      const current = voiceSelect.value || settings.voice.voiceName || "";
      clear(voiceSelect);
      voiceSelect.appendChild(el("option", { text: "Browser default", attrs: { value: "" } }));
      for (const voice of voices) {
        const option = el("option", { text: `${voice.name} (${voice.lang})`, attrs: { value: voice.name } });
        if (voice.name === current) option.selected = true;
        voiceSelect.appendChild(option);
      }
    };
    fillVoices();
    unsubscribeVoices = speech.onVoicesChanged(fillVoices);
    const voiceHint = speech.ttsAvailable()
      ? "Voices come from this browser and operating system; the list can take a moment to fill."
      : "This browser has no text-to-speech; questions will be shown as text only.";
    const testVoice = button("Test voice", () => {
      speech.stopSpeaking();
      speech.speak(["This is how questions will sound.", "Option A: the client with new confusion."], {
        enabled: true,
        rate: Number(rate.value),
        voiceName: voiceSelect.value || undefined,
      });
    }, { testid: "settings-test-voice", disabled: !speech.ttsAvailable() });
    const micNote = speech.sttUnavailableReason();

    const save = button("Save settings", () => saveAll(), { class: "primary", testid: "settings-save" });
    const form = el("form", { class: "card stack" });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      saveAll();
    });
    append(
      form,
      el("h2", { text: "Generation" }),
      field("Claude model id", model, "Used for generating and verifying. Default claude-opus-5."),
      el("h2", { text: "Voice" }),
      enabled.wrapper,
      autoListen.wrapper,
      readRationale.wrapper,
      field("Speech rate", el("div", { class: "row" }, rate, rateValue), "0.5 (slow) to 2 (fast)."),
      field("Voice", voiceSelect, voiceHint),
      micNote ? el("div", { class: "notice", text: micNote }) : null,
      el("div", { class: "row" }, testVoice),
      el("h2", { text: "Quiz" }),
      field("Default number of questions", defaultCount),
      el("div", { class: "row" }, save),
    );
    async function saveAll(): Promise<void> {
      save.disabled = true;
      try {
        const patch = {
          model: model.value.trim() || undefined,
          defaultCount: Math.min(50, Math.max(1, Math.round(Number(defaultCount.value) || settings.defaultCount))),
          voice: {
            enabled: enabled.input.checked,
            autoListen: autoListen.input.checked,
            readRationale: readRationale.input.checked,
            rate: Number(rate.value),
            voiceName: voiceSelect.value || undefined,
          },
        };
        // The server clears the preferred voice only when the key is present, so send it explicitly.
        const body = { ...patch, voice: { ...patch.voice, voiceName: patch.voice.voiceName ?? "" } };
        settings = await api.updateSettings(body);
        if (disposed) return;
        state.setSettings(settings);
        defaultCount.value = String(settings.defaultCount);
        model.value = settings.model;
        status.set("success", "Settings saved.");
      } catch (error) {
        if (!disposed) status.set("error", errorMessage(error));
      } finally {
        save.disabled = false;
      }
    }

    // --- Progress --------------------------------------------------------------------------
    const clearProgress = button("Clear progress", async () => {
      if (!confirm("Delete all recorded attempts? Your questions and sources are kept.")) return;
      try {
        await api.clearStats();
        if (disposed) return;
        state.clearResults();
        status.set("success", "Progress cleared.");
      } catch (error) {
        if (!disposed) status.set("error", errorMessage(error));
      }
    }, { class: "danger", testid: "settings-clear-progress" });
    const progressCard = el("section", { class: "card" }, el("h2", { text: "Progress" }), el("p", { class: "muted small", text: "Removes every recorded attempt, so accuracy and weak areas start from zero." }), el("div", { class: "row" }, clearProgress));

    refreshKeyInfo();
    view.append(status.node, keyCard, form, progressCard);
  }

  return () => {
    disposed = true;
    unsubscribeVoices();
    speech.stopSpeaking();
  };
}
