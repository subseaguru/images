/**
 * Fake Web Speech APIs for the browser under test, installed with `page.addInitScript` before
 * navigation so the app never sees the real (silent, headless) engines.
 *
 * - `speechSynthesis.speak()` records each utterance's text in `window.__spoken` and fires
 *   `onend` asynchronously, one utterance after another.
 * - `SpeechRecognition.start()` takes the next entry from `window.__transcripts` and calls
 *   `onresult` with an event shaped like the real one, then `onend`. With an empty queue it waits
 *   `window.__silenceMs` for `window.__say(text)` and otherwise fires `onerror` ("no-speech")
 *   then `onend`, like a real recogniser that heard nothing.
 */
import type { Page } from "@playwright/test";

/** A transcript, its alternatives (best first), or a recognition error to raise instead. */
export type QueuedTranscript = string | string[] | { error: string };

export interface FakeSpeechOptions {
  transcripts?: QueuedTranscript[];
  /** How long an idle recogniser waits for `__say` before reporting silence. */
  silenceMs?: number;
}

interface TestWindow {
  __spoken: string[];
  __transcripts: QueuedTranscript[];
  __recognitionStarts: number;
  __silenceMs: number;
  __say: (text: QueuedTranscript) => void;
}

function installFakes(options: { transcripts: QueuedTranscript[]; silenceMs: number }): void {
  const w = window as unknown as TestWindow & Record<string, unknown>;
  w.__spoken = [];
  w.__transcripts = options.transcripts.slice();
  w.__recognitionStarts = 0;
  w.__silenceMs = options.silenceMs;

  class FakeUtterance {
    text: string;
    lang = "";
    rate = 1;
    pitch = 1;
    volume = 1;
    voice: unknown = null;
    onstart: ((event: unknown) => void) | null = null;
    onend: ((event: unknown) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    constructor(text?: string) {
      this.text = text ?? "";
    }
    addEventListener(): void {}
    removeEventListener(): void {}
  }

  const synth = {
    speaking: false,
    pending: false,
    paused: false,
    onvoiceschanged: null as unknown,
    queue: [] as FakeUtterance[],
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    speak(utterance: FakeUtterance): void {
      this.queue.push(utterance);
      this.pending = true;
      if (!this.speaking) this.next();
    },
    next(): void {
      const utterance = this.queue.shift();
      if (!utterance) {
        this.speaking = false;
        this.pending = false;
        return;
      }
      this.speaking = true;
      this.pending = this.queue.length > 0;
      w.__spoken.push(utterance.text);
      if (utterance.onstart) utterance.onstart({ utterance });
      this.timer = setTimeout(() => {
        this.timer = undefined;
        if (utterance.onend) utterance.onend({ utterance, charIndex: 0, elapsedTime: 0 });
        this.next();
      }, 10);
    },
    cancel(): void {
      this.queue = [];
      if (this.timer !== undefined) clearTimeout(this.timer);
      this.timer = undefined;
      this.speaking = false;
      this.pending = false;
    },
    pause(): void {},
    resume(): void {},
    getVoices(): unknown[] {
      return [];
    },
    addEventListener(): void {},
    removeEventListener(): void {},
    dispatchEvent(): boolean {
      return true;
    },
  };

  // The recogniser currently waiting for speech, so `__say` can hand it a transcript directly.
  let active: FakeRecognition | null = null;

  class FakeRecognition {
    lang = "";
    maxAlternatives = 1;
    interimResults = false;
    continuous = false;
    onstart: ((event: unknown) => void) | null = null;
    onresult: ((event: unknown) => void) | null = null;
    onerror: ((event: { error: string; message: string }) => void) | null = null;
    onend: ((event: unknown) => void) | null = null;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private done = false;

    start(): void {
      w.__recognitionStarts += 1;
      if (this.onstart) setTimeout(() => this.onstart?.({}), 0);
      const queued = w.__transcripts.shift();
      if (queued !== undefined) {
        this.timer = setTimeout(() => this.finish(queued), 5);
        return;
      }
      active = this;
      this.timer = setTimeout(() => {
        if (active === this) active = null;
        this.fail("no-speech");
      }, w.__silenceMs);
    }

    deliver(text: QueuedTranscript): boolean {
      if (this.done) return false;
      active = null;
      if (this.timer !== undefined) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.finish(text), 5);
      return true;
    }

    stop(): void {
      this.release();
      setTimeout(() => this.end(), 0);
    }

    abort(): void {
      this.release();
      setTimeout(() => {
        if (this.onerror) this.onerror({ error: "aborted", message: "aborted" });
        this.end();
      }, 0);
    }

    addEventListener(): void {}
    removeEventListener(): void {}

    private release(): void {
      if (this.done) return;
      this.done = true;
      if (this.timer !== undefined) clearTimeout(this.timer);
      if (active === this) active = null;
    }

    private finish(text: QueuedTranscript): void {
      if (this.done) return;
      if (typeof text === "object" && !Array.isArray(text)) {
        this.fail(text.error);
        return;
      }
      this.done = true;
      const alternatives = (Array.isArray(text) ? text : [text]).map((transcript) => ({ transcript, confidence: 0.9 }));
      const result = Object.assign(alternatives, { isFinal: true, item: (i: number) => alternatives[i] });
      const results = Object.assign([result], { item: (i: number) => results[i] });
      if (this.onresult) this.onresult({ results, resultIndex: 0 });
      this.end();
    }

    private fail(code: string): void {
      if (this.done) return;
      this.done = true;
      if (this.onerror) this.onerror({ error: code, message: code });
      this.end();
    }

    private end(): void {
      if (this.onend) this.onend({});
    }
  }

  w.__say = (text) => {
    if (active && active.deliver(text)) return;
    w.__transcripts.push(text);
  };

  const define = (name: string, value: unknown) => Object.defineProperty(window, name, { value, configurable: true, writable: true });
  define("speechSynthesis", synth);
  define("SpeechSynthesisUtterance", FakeUtterance);
  define("SpeechRecognition", FakeRecognition);
  define("webkitSpeechRecognition", FakeRecognition);
}

function removeApis(): void {
  for (const name of ["speechSynthesis", "SpeechSynthesisUtterance", "SpeechRecognition", "webkitSpeechRecognition"]) {
    Object.defineProperty(window, name, { value: undefined, configurable: true, writable: true });
  }
}

/** Install the fakes for every document this page loads (including reloads). Call before navigating. */
export async function installSpeechFakes(page: Page, options: FakeSpeechOptions = {}): Promise<void> {
  await page.addInitScript(installFakes, { transcripts: options.transcripts ?? [], silenceMs: options.silenceMs ?? 4000 });
}

/** Make the page look like a browser without any Web Speech API. Call before navigating. */
export async function removeSpeechApis(page: Page): Promise<void> {
  await page.addInitScript(removeApis);
}

export function spoken(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as TestWindow).__spoken ?? []);
}

/** Hand a transcript to the recogniser that is listening now, or queue it for the next one. */
export function say(page: Page, text: QueuedTranscript): Promise<void> {
  return page.evaluate((value) => (window as unknown as TestWindow).__say(value), text);
}

export function recognitionStarts(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as TestWindow).__recognitionStarts ?? 0);
}
