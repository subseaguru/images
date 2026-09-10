/**
 * Text-to-speech and speech recognition wrappers around the Web Speech API.
 *
 * The browser objects are looked up at call time (never cached at module load) so that a test
 * harness can replace `window.speechSynthesis` / `window.SpeechRecognition` before the app runs.
 * `speak` never rejects: errors, cancellation and missing APIs all resolve, so the quiz flow can
 * always continue with on-screen text.
 */

export interface SpeakOptions {
  rate?: number;
  voiceName?: string;
  /** false = voice disabled by the learner; resolves immediately without speaking. */
  enabled?: boolean;
  lang?: string;
}

export interface ListenOptions {
  lang?: string;
  /** Safety net in case the recogniser never fires `end` (ms). */
  timeoutMs?: number;
}

export class ListenError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ListenError";
  }
}

// Minimal typing for the (still prefixed in most browsers) SpeechRecognition API.
interface RecognitionAlternativeLike {
  transcript: string;
}
interface RecognitionResultLike {
  length: number;
  [index: number]: RecognitionAlternativeLike;
}
interface RecognitionEventLike {
  results: { length: number; [index: number]: RecognitionResultLike };
}
interface RecognitionErrorEventLike {
  error: string;
  message?: string;
}
interface RecognitionLike {
  lang: string;
  maxAlternatives: number;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: RecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => RecognitionLike;

function synth(): SpeechSynthesis | undefined {
  const w = window as Window & { speechSynthesis?: SpeechSynthesis };
  return typeof w.speechSynthesis === "object" && w.speechSynthesis ? w.speechSynthesis : undefined;
}

function utteranceCtor(): (typeof SpeechSynthesisUtterance) | undefined {
  const w = window as Window & { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance };
  return typeof w.SpeechSynthesisUtterance === "function" ? w.SpeechSynthesisUtterance : undefined;
}

function recognitionCtor(): RecognitionCtor | undefined {
  const w = window as Window & { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  const ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  return typeof ctor === "function" ? ctor : undefined;
}

export function ttsAvailable(): boolean {
  return synth() !== undefined && utteranceCtor() !== undefined;
}

export function sttAvailable(): boolean {
  return recognitionCtor() !== undefined;
}

/** Recognition needs a secure context (localhost or HTTPS); explain why the mic is off otherwise. */
export function sttUnavailableReason(): string | null {
  if (sttAvailable()) return null;
  const secure = typeof window.isSecureContext === "boolean" ? window.isSecureContext : true;
  if (!secure) {
    return "Voice answers need a secure page: open the app at http://localhost or over HTTPS (start the server with HTTPS=1).";
  }
  return "Voice answers are not supported in this browser. Use Chrome or Edge on localhost or HTTPS, or answer by tapping or typing A, B or C.";
}

export function getVoices(): SpeechSynthesisVoice[] {
  const s = synth();
  if (!s || typeof s.getVoices !== "function") return [];
  try {
    return s.getVoices() ?? [];
  } catch {
    return [];
  }
}

/** Subscribe to `voiceschanged`; returns an unsubscribe function. */
export function onVoicesChanged(listener: () => void): () => void {
  const s = synth();
  if (!s || typeof s.addEventListener !== "function") return () => {};
  s.addEventListener("voiceschanged", listener);
  return () => s.removeEventListener("voiceschanged", listener);
}

// A monotonically increasing token identifies the current speak() call so that stop() and stale
// callbacks from cancelled utterances cannot resolve or interfere with a newer call.
let speakToken = 0;
let pendingResolve: (() => void) | null = null;
// Chrome garbage-collects utterances that are still queued unless something references them.
let liveUtterances: SpeechSynthesisUtterance[] = [];
let currentRecognition: RecognitionLike | null = null;
let speakingNow = false;

export function isSpeaking(): boolean {
  return speakingNow;
}

function finishSpeak(): void {
  speakingNow = false;
  liveUtterances = [];
  const resolve = pendingResolve;
  pendingResolve = null;
  if (resolve) resolve();
}

/**
 * Speak `chunks` one after another and resolve when the last one ends. Chrome truncates long
 * utterances, hence sentence-sized chunks; it also occasionally never fires `end`, hence a
 * per-chunk timeout proportional to the text length.
 */
export function speak(chunks: string[], options: SpeakOptions = {}): Promise<void> {
  stopSpeaking();
  const s = synth();
  const Utterance = utteranceCtor();
  const texts = chunks.map((c) => c.trim()).filter((c) => c !== "");
  if (!s || !Utterance || options.enabled === false || texts.length === 0) return Promise.resolve();

  const token = ++speakToken;
  return new Promise<void>((resolve) => {
    pendingResolve = resolve;
    speakingNow = true;
    const rate = clampRate(options.rate ?? 1);
    const voice = options.voiceName ? getVoices().find((v) => v.name === options.voiceName) : undefined;
    let remaining = texts.length;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const done = () => {
      if (token !== speakToken) return;
      if (timer !== undefined) clearTimeout(timer);
      finishSpeak();
    };
    const armTimeout = (text: string) => {
      if (timer !== undefined) clearTimeout(timer);
      // ~15 characters per second at rate 1 plus generous slack for engine start-up.
      const ms = 4000 + (text.length * 90) / rate;
      timer = setTimeout(() => {
        if (token !== speakToken) return;
        try {
          s.cancel();
        } catch {
          // Cancelling a wedged engine may throw in some browsers; the promise resolves anyway.
        }
        done();
      }, ms);
    };
    const chunkFinished = () => {
      if (token !== speakToken) return;
      remaining -= 1;
      if (remaining <= 0) {
        done();
        return;
      }
      const next = texts[texts.length - remaining];
      if (next !== undefined) armTimeout(next);
    };

    try {
      // Chrome can leave the engine paused after a cancel; resume() is harmless otherwise.
      if (typeof s.resume === "function") s.resume();
      for (const text of texts) {
        const utterance = new Utterance(text);
        utterance.rate = rate;
        if (options.lang) utterance.lang = options.lang;
        if (voice) utterance.voice = voice;
        utterance.onend = chunkFinished;
        utterance.onerror = chunkFinished;
        liveUtterances.push(utterance);
        s.speak(utterance);
      }
      const first = texts[0];
      if (first !== undefined) armTimeout(first);
    } catch {
      done();
    }
  });
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.min(2, Math.max(0.5, rate));
}

/** Cancel any speech in progress and resolve its pending promise. */
export function stopSpeaking(): void {
  speakToken += 1;
  const s = synth();
  if (s) {
    try {
      s.cancel();
    } catch {
      // Ignore engines that refuse to cancel.
    }
  }
  finishSpeak();
}

/** Abort recognition in progress; its promise resolves with []. */
export function stopListening(): void {
  const recognition = currentRecognition;
  currentRecognition = null;
  if (recognition) {
    try {
      recognition.abort();
    } catch {
      // Already stopped.
    }
  }
}

/** Stop everything: speech and listening. */
export function stop(): void {
  stopSpeaking();
  stopListening();
}

/**
 * Listen for one utterance and resolve with its alternative transcripts (best first). Resolves
 * `[]` on silence or abort; rejects with `ListenError` when the microphone is blocked or missing.
 */
export function listen(options: ListenOptions = {}): Promise<string[]> {
  const Recognition = recognitionCtor();
  if (!Recognition) {
    return Promise.reject(new ListenError("unavailable", sttUnavailableReason() ?? "Speech recognition is unavailable."));
  }
  stopListening();
  return new Promise<string[]>((resolve, reject) => {
    let recognition: RecognitionLike;
    try {
      recognition = new Recognition();
    } catch (error) {
      reject(new ListenError("unavailable", (error as Error).message));
      return;
    }
    currentRecognition = recognition;
    recognition.lang = options.lang ?? "en-US";
    recognition.maxAlternatives = 5;
    recognition.interimResults = false;
    recognition.continuous = false;

    let settled = false;
    let transcripts: string[] = [];
    let failure: ListenError | null = null;
    const timer = setTimeout(() => {
      if (settled) return;
      try {
        recognition.abort();
      } catch {
        // Ignore.
      }
      settle();
    }, options.timeoutMs ?? 20_000);

    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (currentRecognition === recognition) currentRecognition = null;
      if (failure) reject(failure);
      else resolve(transcripts);
    };

    recognition.onresult = (event) => {
      const collected: string[] = [];
      const result = event.results[event.results.length - 1];
      if (result) {
        for (let i = 0; i < result.length; i += 1) {
          const alternative = result[i];
          if (alternative && typeof alternative.transcript === "string" && alternative.transcript.trim() !== "") {
            collected.push(alternative.transcript.trim());
          }
        }
      }
      transcripts = collected;
    };
    recognition.onerror = (event) => {
      const code = event.error;
      if (code === "not-allowed" || code === "service-not-allowed") {
        failure = new ListenError("not-allowed", "Microphone access was blocked. Allow the microphone for this site to answer by voice.");
      } else if (code === "audio-capture") {
        failure = new ListenError("audio-capture", "No microphone was found.");
      } else if (code === "network") {
        failure = new ListenError("network", "Speech recognition needs a network connection in this browser.");
      }
      // no-speech / aborted: resolve with whatever was collected (usually nothing).
      settle();
    };
    recognition.onend = () => settle();

    try {
      recognition.start();
    } catch (error) {
      failure = new ListenError("start-failed", (error as Error).message);
      settle();
    }
  });
}
