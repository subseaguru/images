/**
 * Quiz screen. One question at a time through a small state machine:
 *
 *   reading (TTS) -> listening (STT) -> answered (feedback shown and spoken) -> next question
 *
 * The DOM is built once per mount and updated in place, so there is exactly one set of listeners
 * no matter how many questions are shown. Every asynchronous step (speech ending, a transcript
 * arriving, the attempt request) checks a per-question token before touching the screen, so a
 * fast answer, Skip, Stop or leaving the page can never resurrect a stale step.
 */
import type { InputMode, OptionLabel, Question } from "../../shared/types.js";
import { OPTION_LABELS } from "../../shared/types.js";
import { buildFeedbackScript, buildQuestionScript, isOptionLabel, parseSpokenCommand } from "../../shared/spoken.js";
import { api, errorMessage } from "../api.js";
import type { Dispose } from "../router.js";
import { navigate } from "../router.js";
import * as speech from "../speech.js";
import * as state from "../state.js";
import type { QuizAnswer, QuizSession } from "../state.js";
import { button, clear, el, focus, isTypingTarget, safeCategoryName } from "../ui.js";

type Phase = "reading" | "listening" | "answered" | "done";

const MAX_SILENT_RETRIES = 3;
const HELP_TEXT = "Tap an answer or say A, B or C.";

export function quizView(root: HTMLElement): Dispose {
  const session = state.getQuiz();
  if (!session || session.questions.length === 0) {
    root.appendChild(el("div", { class: "view" }, el("p", { text: "No quiz in progress." }), el("p", {}, el("a", { text: "Set one up on the Home page.", attrs: { href: "#/" } }))));
    return () => {};
  }
  const quiz = new QuizController(root, session);
  quiz.start();
  return () => quiz.dispose();
}

class QuizController {
  private phase: Phase = "reading";
  private turn = 0;
  /** Bumped whenever listening must be abandoned, so a stale transcript (or the [] from an abort) is ignored. */
  private listenId = 0;
  private disposed = false;
  private shownAt = 0;
  private silentRetries = 0;
  private settings = state.cachedSettings();

  private readonly progress: HTMLElement;
  private readonly categoryChip: HTMLElement;
  private readonly stem: HTMLElement;
  private readonly optionButtons = new Map<OptionLabel, HTMLButtonElement>();
  private readonly optionTexts = new Map<OptionLabel, HTMLElement>();
  private readonly micStatus: HTMLElement;
  private readonly listenButton: HTMLButtonElement;
  private readonly feedback: HTMLElement;
  private readonly onKeyDown = (event: KeyboardEvent) => this.handleKey(event);

  constructor(
    root: HTMLElement,
    private session: QuizSession,
  ) {
    this.progress = el("div", { class: "quiz-progress", testid: "quiz-progress", attrs: { "aria-live": "polite" } });
    this.categoryChip = el("span", { class: "chip" });
    this.stem = el("p", { class: "stem", testid: "question-stem" });
    const options = el("div", { class: "options-grid", attrs: { role: "group", "aria-label": "Answer options" } });
    for (const label of OPTION_LABELS) {
      const text = el("span", { class: "text" });
      const node = el(
        "button",
        { class: "option", testid: `option-${label}`, attrs: { type: "button" } },
        el("span", { class: "label", text: label, attrs: { "aria-hidden": "true" } }),
        el("span", { class: "sr-only", text: `Option ${label}: ` }),
        text,
      );
      node.addEventListener("click", () => this.answer(label, "tap"));
      this.optionButtons.set(label, node);
      this.optionTexts.set(label, text);
      options.appendChild(node);
    }
    this.micStatus = el("div", { class: "mic-status", testid: "mic-status", attrs: { "aria-live": "polite", role: "status" } });
    this.listenButton = button("Answer by voice", () => this.listenNow(), { class: "small", title: "Start listening for a spoken answer" });
    this.listenButton.hidden = true;
    this.feedback = el("section", { class: "feedback", attrs: { "aria-label": "Feedback" } });

    const controls = el(
      "div",
      { class: "quiz-controls" },
      button("Repeat", () => this.repeat(), { testid: "repeat-question", title: "Read the question again (R)" }),
      button("Skip", () => this.skip(), { testid: "skip-question", title: "Skip without answering (S)" }),
      button("Stop", () => this.stop(), { testid: "stop-quiz", class: "danger", title: "End the quiz and see results (Esc)" }),
      this.listenButton,
    );
    const help = el("p", { class: "muted small", text: "Keyboard: A/B/C or 1/2/3 answer, R repeat, N or Enter next, S skip, Esc stop." });

    root.appendChild(
      el(
        "div",
        { class: "view quiz" },
        el("div", { class: "quiz-top" }, this.progress, this.categoryChip),
        this.stem,
        options,
        this.micStatus,
        controls,
        this.feedback,
        help,
      ),
    );
    document.addEventListener("keydown", this.onKeyDown);
  }

  start(): void {
    state.loadSettings().then((loaded) => {
      if (this.disposed) return;
      this.settings = loaded;
      // Settings arrive after the first question is shown; only later questions pick up the voice.
    });
    this.present();
  }

  dispose(): void {
    this.disposed = true;
    this.turn += 1;
    document.removeEventListener("keydown", this.onKeyDown);
    speech.stop();
  }

  /** Silence speech and abandon any listening in progress. */
  private hush(): void {
    this.listenId += 1;
    speech.stop();
  }

  // -------------------------------------------------------------------------------------------
  // Question flow
  // -------------------------------------------------------------------------------------------

  private get question(): Question | undefined {
    return this.session.questions[this.session.index];
  }

  private get voiceOn(): boolean {
    return this.session.options.voice && speech.ttsAvailable();
  }

  private voiceOptions(): speech.SpeakOptions {
    return { enabled: this.session.options.voice, rate: this.settings.voice.rate, voiceName: this.settings.voice.voiceName };
  }

  private present(): void {
    const question = this.question;
    if (!question) {
      this.finish();
      return;
    }
    this.turn += 1;
    this.phase = "reading";
    this.silentRetries = 0;
    this.shownAt = Date.now();
    const total = this.session.questions.length;
    this.progress.textContent = `${this.session.index + 1} / ${total}`;
    this.categoryChip.textContent = safeCategoryName(question.category);
    this.stem.textContent = question.stem;
    for (const option of question.options) {
      const text = this.optionTexts.get(option.label);
      if (text) text.textContent = option.text;
    }
    for (const node of this.optionButtons.values()) {
      node.disabled = false;
      node.classList.remove("chosen", "correct");
      node.removeAttribute("aria-pressed");
    }
    clear(this.feedback);
    this.listenButton.hidden = !(this.session.options.voice && speech.sttAvailable() && !state.isMicDenied());
    focus(this.optionButtons.get("A"));
    this.read();
  }

  /** Read (or re-read) the current question, then hand over to the microphone. */
  private read(): void {
    const question = this.question;
    if (!question) return;
    const turn = this.turn;
    if (!this.voiceOn) {
      this.setMicStatus(this.idleMicText(), "");
      return;
    }
    this.setMicStatus("Reading the question…", "speaking");
    const script = buildQuestionScript(question, this.session.index, this.session.questions.length);
    speech.speak(script, this.voiceOptions()).then(() => {
      if (turn !== this.turn || this.phase !== "reading") return;
      this.setMicStatus(this.idleMicText(), "");
      this.maybeListen();
    });
  }

  private idleMicText(): string {
    if (!this.session.options.voice) return "Voice is off for this quiz. Tap an answer or press A, B or C.";
    const reason = speech.sttUnavailableReason();
    if (reason) return reason;
    if (state.isMicDenied()) return "Microphone access was blocked, so voice answers are off for this session. Tap an answer or press A, B or C.";
    if (!this.settings.voice.autoListen) return "Auto-listen is off. Use “Answer by voice”, tap an answer or press A, B or C.";
    return HELP_TEXT;
  }

  private setMicStatus(text: string, mode: "" | "listening" | "speaking"): void {
    this.micStatus.textContent = text;
    this.micStatus.className = `mic-status ${mode}`.trim();
  }

  private maybeListen(): void {
    if (!this.session.options.voice || !this.settings.voice.autoListen) return;
    if (!speech.sttAvailable() || state.isMicDenied()) return;
    this.listen();
  }

  private listenNow(): void {
    if (this.phase === "done" || speech.isSpeaking()) return;
    this.listenId += 1;
    speech.stopListening();
    this.silentRetries = 0;
    this.listen();
  }

  /** Listen for one utterance; only ever called after speech has finished. */
  private listen(): void {
    if (this.disposed || speech.isSpeaking()) return;
    const turn = this.turn;
    const id = ++this.listenId;
    const phaseBefore = this.phase;
    if (phaseBefore === "reading") this.phase = "listening";
    this.setMicStatus(phaseBefore === "answered" ? "Listening… say “next”, “repeat” or “stop”." : "Listening… say A, B or C.", "listening");
    speech
      .listen()
      .then((transcripts) => {
        if (id !== this.listenId || turn !== this.turn || this.disposed) return;
        if (this.phase === "listening") this.phase = "reading";
        const command = parseSpokenCommand(transcripts);
        if (command?.kind === "answer") {
          if (this.phase === "answered") {
            this.retryListen(`Heard “${transcripts[0] ?? ""}”. Say “next” to continue.`);
            return;
          }
          this.answer(command.label, "voice");
          return;
        }
        if (command?.kind === "repeat") {
          this.repeat();
          return;
        }
        if (command?.kind === "next") {
          if (this.phase === "answered") this.next();
          else this.retryListen("Answer first, or say “skip”.");
          return;
        }
        if (command?.kind === "skip") {
          this.skip();
          return;
        }
        if (command?.kind === "stop") {
          this.stop();
          return;
        }
        const heard = transcripts[0];
        this.retryListen(heard ? `Heard “${heard}”. ${HELP_TEXT}` : "Didn't hear anything.");
      })
      .catch((error: unknown) => {
        if (id !== this.listenId || turn !== this.turn || this.disposed) return;
        if (this.phase === "listening") this.phase = "reading";
        const code = error instanceof speech.ListenError ? error.code : "unknown";
        if (code === "not-allowed" || code === "audio-capture") {
          state.setMicDenied(true);
          this.listenButton.hidden = true;
        }
        this.setMicStatus(`${errorMessage(error)} Tap an answer or press A, B or C.`, "");
      });
  }

  private retryListen(reason: string): void {
    this.silentRetries += 1;
    if (this.silentRetries < MAX_SILENT_RETRIES) {
      this.setMicStatus(`${reason} Listening again…`, "listening");
      this.listen();
    } else {
      this.setMicStatus(this.phase === "answered" ? "Press Next or say “next” to continue." : HELP_TEXT, "");
    }
  }

  private answer(label: OptionLabel, inputMode: InputMode): void {
    const question = this.question;
    if (!question || this.phase === "answered" || this.phase === "done") return;
    this.hush();
    this.phase = "answered";
    this.silentRetries = 0;
    const turn = this.turn;
    const responseMs = Math.max(0, Date.now() - this.shownAt);
    for (const [key, node] of this.optionButtons) {
      node.disabled = true;
      if (key === label) node.setAttribute("aria-pressed", "true");
    }
    this.setMicStatus("Checking…", "");

    api
      .recordAttempt({ sessionId: this.session.sessionId, questionId: question.id, chosen: label, inputMode, responseMs })
      .then(
        (response) => ({ correct: response.correct, isCorrect: response.isCorrect, unsaved: false, warning: "" }),
        (error: unknown) => ({
          correct: question.correct,
          isCorrect: label === question.correct,
          unsaved: true,
          warning: `This answer could not be saved (${errorMessage(error)}). The result below was checked locally.`,
        }),
      )
      .then((verdict) => {
        if (turn !== this.turn || this.disposed) return;
        const record: QuizAnswer = {
          questionId: question.id,
          category: question.category,
          chosen: label,
          correct: verdict.correct,
          isCorrect: verdict.isCorrect,
          inputMode,
          responseMs,
        };
        if (verdict.unsaved) record.unsaved = true;
        this.session = { ...this.session, answers: [...this.session.answers, record] };
        state.saveQuiz(this.session);
        this.showFeedback(question, record, verdict.warning);
      });
  }

  private showFeedback(question: Question, record: QuizAnswer, warning: string): void {
    const verdictQuestion: Question = { ...question, correct: record.correct };
    for (const [key, node] of this.optionButtons) {
      if (key === record.correct) node.classList.add("correct");
      if (key === record.chosen) node.classList.add("chosen");
    }
    clear(this.feedback);
    const banner = el("div", {
      class: `feedback-banner ${record.isCorrect ? "correct" : "wrong"}`,
      testid: "feedback-banner",
      text: record.isCorrect ? "Correct" : `Wrong – the answer is ${record.correct}`,
      attrs: { role: "status", "aria-live": "polite" },
    });
    const list = el("ul", { class: "feedback-list" });
    for (const option of question.options) {
      const classes = [option.label === record.correct ? "correct" : "", option.label === record.chosen ? "chosen" : ""].join(" ").trim();
      const tag = option.label === record.correct ? " – correct answer" : option.label === record.chosen ? " – your answer" : "";
      list.appendChild(
        el(
          "li",
          { class: classes },
          el("div", { class: "head", text: `${option.label}. ${option.text}${tag}` }),
          el("div", { class: "rationale", text: option.rationale, testid: `feedback-rationale-${option.label}` }),
        ),
      );
    }
    const nextButton = button(this.session.index + 1 >= this.session.questions.length ? "See results" : "Next question", () => this.next(), {
      class: "primary large",
      testid: "next-question",
      title: "Next (N or Enter)",
    });
    this.feedback.append(banner);
    if (warning) this.feedback.appendChild(el("div", { class: "notice warn", text: warning, attrs: { role: "alert" } }));
    this.feedback.append(list);
    if (question.teachingPoint) {
      this.feedback.appendChild(el("div", { class: "teaching-point", testid: "teaching-point" }, el("strong", { text: "Teaching point" }), question.teachingPoint));
    }
    this.feedback.appendChild(el("div", { class: "row" }, nextButton));
    focus(nextButton);
    this.speakFeedback(verdictQuestion, record.chosen);
  }

  private speakFeedback(question: Question, chosen: OptionLabel): void {
    const turn = this.turn;
    if (!this.voiceOn) {
      this.setMicStatus("Press Next or N to continue.", "");
      return;
    }
    this.setMicStatus("Reading the feedback…", "speaking");
    speech.speak(buildFeedbackScript(question, chosen, this.settings.voice.readRationale), this.voiceOptions()).then(() => {
      if (turn !== this.turn || this.phase !== "answered") return;
      this.setMicStatus("Press Next or say “next” to continue.", "");
      this.silentRetries = 0;
      this.maybeListen();
    });
  }

  private repeat(): void {
    if (this.phase === "done") return;
    this.hush();
    if (this.phase === "answered") {
      const question = this.question;
      const last = this.session.answers[this.session.answers.length - 1];
      if (question && last && last.questionId === question.id) this.speakFeedback({ ...question, correct: last.correct }, last.chosen);
      return;
    }
    this.phase = "reading";
    this.silentRetries = 0;
    this.read();
  }

  private next(): void {
    if (this.phase !== "answered") return;
    this.advance();
  }

  /** Move on without recording anything. */
  private skip(): void {
    if (this.phase === "done") return;
    const question = this.question;
    if (question && this.phase !== "answered") {
      this.session = { ...this.session, skipped: [...this.session.skipped, question.id] };
    }
    this.advance();
  }

  private advance(): void {
    this.hush();
    this.session = { ...this.session, index: this.session.index + 1 };
    if (this.session.index >= this.session.questions.length) {
      this.finish();
      return;
    }
    state.saveQuiz(this.session);
    this.present();
  }

  private stop(): void {
    if (this.phase === "done") return;
    this.finish();
  }

  private finish(): void {
    this.phase = "done";
    this.turn += 1;
    this.hush();
    state.saveQuiz(this.session);
    state.finishQuiz();
    navigate("/results");
  }

  // -------------------------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------------------------

  private handleKey(event: KeyboardEvent): void {
    if (this.disposed || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (isTypingTarget(event.target)) return;
    const key = event.key;
    if (key === "Enter") {
      // A focused button already handles Enter natively (Next, Repeat, Skip…).
      if (event.target instanceof HTMLButtonElement) return;
      if (this.phase === "answered") {
        event.preventDefault();
        this.next();
      }
      return;
    }
    if (key === "Escape") {
      event.preventDefault();
      this.stop();
      return;
    }
    if (key.length !== 1) return;
    const upper = key.toUpperCase();
    const numeric: Record<string, OptionLabel> = { "1": "A", "2": "B", "3": "C" };
    const label = isOptionLabel(upper) ? upper : numeric[upper];
    if (label) {
      if (this.phase !== "answered" && this.phase !== "done") {
        event.preventDefault();
        this.answer(label, "keyboard");
      }
      return;
    }
    if (upper === "R") {
      event.preventDefault();
      this.repeat();
    } else if (upper === "N") {
      event.preventDefault();
      this.next();
    } else if (upper === "S") {
      event.preventDefault();
      this.skip();
    }
  }
}
