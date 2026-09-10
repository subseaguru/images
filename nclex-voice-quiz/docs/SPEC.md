# NCLEX Voice Quiz - product & UI specification

A single-user study website that runs on a computer on the home network and is opened in a browser
(`http://localhost:3000` on the same machine, or `http://<lan-ip>:3000` from another device).

## Core loop
1. **Start a quiz** (count, categories, sources, difficulty, voice on/off).
2. **The question is read aloud** (browser `speechSynthesis`) and shown on screen:
   "Question 3 of 10. <stem>. Option A: <text>. Option B: <text>. Option C: <text>."
3. **The learner answers** by voice ("B", "bravo", "option C", "the first one"...), by tapping the
   option, or with the keyboard (A/B/C or 1/2/3).
4. **Feedback**: a large banner (**CORRECT** in green / **WRONG** in red) and it is spoken:
   - correct: "Correct. <rationale of the correct option>"
   - wrong: "Wrong. <rationale of the chosen option> The correct answer is <label>, <text>. <rationale of the correct option>"
   All three options are shown with their rationale (chosen and correct highlighted) plus the
   teaching point. The attempt is posted to `/api/attempts`.
5. **Next** (button, "next" by voice, or N/Enter). After the last question: **Results**.
6. **Results**: score, per-category accuracy, missed questions with rationales, buttons to
   "Practice weak areas" (starts a quiz restricted to the weak categories) and "New quiz".

## Screens (hash routing: `#/`, `#/quiz`, `#/results`, `#/generate`, `#/sources`, `#/bank`, `#/settings`)
- **Home** (`#/`): quiz setup form + a stats snapshot (overall accuracy, weakest categories, bank
  size) + "Start quiz" button. Category checkboxes show the blueprint percentage next to each name.
- **Quiz** (`#/quiz`): progress "3 / 10", category chip, stem, three big option buttons, mic
  status ("Listening…" / "Voice answers not supported in this browser"), controls: Repeat, Skip,
  Stop. Feedback panel appears below after answering, with Next.
- **Results** (`#/results`).
- **Generate** (`#/generate`): count (1-20), categories (or "follow the NCLEX blueprint"),
  difficulty, clinical-judgment step (optional), study sources checklist, "Let Claude research
  online" toggle, "Target my weak areas" toggle, focus text. Shows a progress state while
  generating (can take 1-3 minutes), then the new questions (expandable rationales), the research
  brief when present, token usage, and warnings. If no API key is configured, show a callout
  linking to Settings instead of the form's submit button.
- **Sources** (`#/sources`): list of study sources; add by pasting text (name + textarea), by URL,
  or by uploading a file (`.txt`, `.md`, `.pdf`, `.html`); preview and delete.
- **Bank** (`#/bank`): browse/filter the question bank (category, source, search), expand a
  question to see options/rationales, delete AI/imported questions, import a JSON file, export the
  bank as JSON (download via a Blob URL).
- **Settings** (`#/settings`): API key (masked hint, save/remove/verify; read-only note when it
  comes from the environment), model id (default `claude-opus-5`), voice settings (enabled, rate
  slider 0.5-2, voice picker from `speechSynthesis.getVoices()`, auto-listen, read rationale, a
  "Test voice" button), default question count, "Clear progress".

## Speech details (`src/web/speech.ts`)
- TTS via `window.speechSynthesis`. Chrome silently truncates long utterances, so speak in
  sentence-sized chunks queued one after another; expose `speak(chunks): Promise<void>` that
  resolves when the last chunk ends (or immediately when TTS is unavailable/disabled), and
  `stop()`. Speaking must be triggered after a user gesture (the Start/Next click qualifies).
  Re-query voices on `voiceschanged`.
- STT via `window.SpeechRecognition || window.webkitSpeechRecognition` (Chrome/Edge; needs a
  secure context: `localhost` or HTTPS). `listen(): Promise<string[]>` returns the alternative
  transcripts of one utterance (`maxAlternatives = 5`, `interimResults = false`, `lang = "en-US"`),
  rejects on `not-allowed`/`audio-capture`, resolves `[]` on `no-speech`/`aborted`. Listening starts
  only after the question audio finishes (never talk over the microphone) and is retried up to 3
  times on silence before showing "Tap an answer or say A, B or C".
- Answer parsing lives in `src/shared/spoken.ts` so it is unit-tested on the server side:
  - `buildQuestionScript(question, index, total): string[]`
  - `buildFeedbackScript(question, chosen, readRationale): string[]`
  - `parseSpokenCommand(transcripts: string[]): { kind: "answer", label } | { kind: "repeat" | "next" | "skip" | "stop" } | null`
    Accepts letters ("a", "bee", "see"/"sea"/"c"), NATO ("alpha", "bravo", "charlie"), ordinals
    ("first", "second", "third", "one/two/three"), phrases ("option b", "answer c", "the second one",
    "i think it's a"), and commands ("repeat", "say again", "next", "skip", "stop"). Prefer an
    explicit option phrase over a stray letter; return null when ambiguous (two different labels).

## Keyboard
A/B/C or 1/2/3 answer; R repeat; N or Enter next; S skip; Esc stop.

## Look & feel
Clean, high-contrast, large type (stem >= 1.4rem, options >= 1.2rem, feedback banner >= 2rem),
works on phone widths (buttons stack), respects `prefers-color-scheme` (light and dark), no
external assets (fonts/icons inline or system). One stylesheet: `public/styles.css`.

## Test ids (Playwright relies on these `data-testid` values)
`nav-home`, `nav-generate`, `nav-sources`, `nav-bank`, `nav-settings`,
`quiz-count`, `quiz-category-<CategoryId>`, `quiz-voice-toggle`, `start-quiz`,
`quiz-progress`, `question-stem`, `option-A`, `option-B`, `option-C`, `mic-status`,
`repeat-question`, `skip-question`, `stop-quiz`, `feedback-banner` (text starts with
"Correct" or "Wrong"), `feedback-rationale-A/B/C`, `teaching-point`, `next-question`,
`results-score`, `results-category-<CategoryId>`, `practice-weak`, `new-quiz`,
`generate-count`, `generate-submit`, `generate-status`, `generate-result`,
`source-name`, `source-text`, `source-add-text`, `source-url`, `source-add-url`, `source-file`,
`source-list`, `settings-api-key`, `settings-save-key`, `settings-remove-key`, `settings-verify-key`,
`settings-model`, `settings-save`, `settings-status`, `bank-list`, `bank-search`.

## Browser test hooks
`window.__nclex` exposes `{ speech: { speak, listen, stop }, state }` so Playwright can inject
fakes (via `page.addInitScript`) for `speechSynthesis` and `SpeechRecognition`. The app must work
(with buttons) when neither API exists.
