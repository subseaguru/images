/**
 * Home: quiz setup form plus a snapshot of progress and the bank size.
 */
import type { CategoryId, Difficulty, QuestionSource, Stats } from "../../shared/types.js";
import { DIFFICULTIES, QUESTION_SOURCES } from "../../shared/types.js";
import { api, errorMessage } from "../api.js";
import type { QuestionsResponse } from "../api.js";
import type { Dispose } from "../router.js";
import { navigate } from "../router.js";
import * as speech from "../speech.js";
import * as state from "../state.js";
import type { QuizOptions } from "../state.js";
import { append, button, categoryChecklist, checkbox, clear, difficultyLabel, el, field, percent, safeCategoryName, sourceLabel, statusBox } from "../ui.js";

export function homeView(root: HTMLElement): Dispose {
  let disposed = false;
  const view = el("div", { class: "view stack" }, el("h1", { text: "Practice NCLEX-RN questions" }));
  root.appendChild(view);

  const resumeSlot = el("div");
  const statsCard = el("section", { class: "card" }, el("h2", { text: "Your progress" }), el("p", { class: "muted", text: "Loading…" }));
  const setupCard = el("section", { class: "card" }, el("h2", { text: "Start a quiz" }));
  view.append(resumeSlot, el("div", { class: "grid-2" }, setupCard, statsCard));

  renderResume(resumeSlot);
  renderSetup(setupCard);
  Promise.all([api.stats().catch(() => null), api.questions().catch(() => null)]).then(([stats, questions]) => {
    if (disposed) return;
    renderStats(statsCard, stats, questions);
  });
  return () => {
    disposed = true;
  };
}

function renderResume(slot: HTMLElement): void {
  const quiz = state.getQuiz();
  if (!quiz) return;
  slot.appendChild(
    el(
      "div",
      { class: "notice row between" },
      el("span", { text: `A quiz is in progress (question ${quiz.index + 1} of ${quiz.questions.length}).` }),
      el(
        "span",
        { class: "row" },
        button("Resume", () => navigate("/quiz"), { class: "primary small", testid: "resume-quiz" }),
        button("Discard", () => {
          state.discardQuiz();
          clear(slot);
        }, { class: "small" }),
      ),
    ),
  );
}

function renderSetup(card: HTMLElement): void {
  const settings = state.cachedSettings();
  const status = statusBox("home-status");
  const count = el("input", { testid: "quiz-count", attrs: { type: "number", min: "1", max: "50", step: "1" } });
  count.value = String(settings.defaultCount);
  state.loadSettings().then((loaded) => {
    if (count.value === String(settings.defaultCount)) count.value = String(loaded.defaultCount);
    voice.input.checked = loaded.voice.enabled;
  });

  const categories = categoryChecklist("quiz-category", () => true);
  const sourceInputs = new Map<QuestionSource, HTMLInputElement>();
  const sourcesNode = el("div", { class: "row" });
  for (const source of QUESTION_SOURCES) {
    const box = checkbox(sourceLabel(source), { checked: true, value: source, testid: `quiz-source-${source}` });
    sourceInputs.set(source, box.input);
    sourcesNode.appendChild(box.wrapper);
  }
  const difficultyInputs = new Map<Difficulty, HTMLInputElement>();
  const difficultyNode = el("div", { class: "row" });
  for (const difficulty of DIFFICULTIES) {
    const box = checkbox(difficultyLabel(difficulty), { checked: true, value: difficulty, testid: `quiz-difficulty-${difficulty}` });
    difficultyInputs.set(difficulty, box.input);
    difficultyNode.appendChild(box.wrapper);
  }
  const voice = checkbox("Read questions aloud and answer by voice", { checked: settings.voice.enabled, testid: "quiz-voice-toggle" });
  const voiceHint = el("div", { class: "hint small muted" });
  if (!speech.ttsAvailable()) voiceHint.textContent = "This browser has no text-to-speech; questions will be shown as text only.";
  else if (!speech.sttAvailable()) voiceHint.textContent = speech.sttUnavailableReason() ?? "";

  const startButton = button("Start quiz", () => start(), { class: "primary large", testid: "start-quiz" });
  const form = el("form", { class: "stack" });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    start();
  });
  append(
    form,
    field("Number of questions", count, "1 to 50; the bank is sampled following the NCLEX-RN blueprint."),
    el("fieldset", {}, el("legend", { text: "Categories (blueprint share)" }), categories.node, el("div", { class: "row" }, button("All", () => setAll(categories.inputs, true), { class: "small" }), button("None", () => setAll(categories.inputs, false), { class: "small" }))),
    el("fieldset", {}, el("legend", { text: "Question sources" }), sourcesNode),
    el("fieldset", {}, el("legend", { text: "Difficulty" }), difficultyNode),
    el("div", { class: "field" }, voice.wrapper, voiceHint),
    status.node,
    el("div", { class: "row" }, startButton),
  );
  card.appendChild(form);

  function selected<T extends string>(inputs: Map<T, HTMLInputElement>): T[] {
    return [...inputs.entries()].filter(([, input]) => input.checked).map(([id]) => id);
  }

  async function start(): Promise<void> {
    const n = Math.min(50, Math.max(1, Math.round(Number(count.value) || settings.defaultCount)));
    count.value = String(n);
    const chosenCategories = categories.selected();
    const chosenSources = selected(sourceInputs);
    const chosenDifficulty = selected(difficultyInputs);
    if (chosenCategories.length === 0) {
      status.set("error", "Pick at least one category.");
      return;
    }
    if (chosenSources.length === 0) {
      status.set("error", "Pick at least one question source.");
      return;
    }
    const options: QuizOptions = {
      voice: voice.input.checked,
      categories: chosenCategories.length === categories.inputs.size ? undefined : chosenCategories,
      sources: chosenSources.length === sourceInputs.size ? undefined : chosenSources,
      difficulty: chosenDifficulty.length === difficultyInputs.size ? undefined : chosenDifficulty,
    };
    startButton.disabled = true;
    status.set("info", "Selecting questions…");
    try {
      const response = await api.startQuiz(state.quizRequest(n, options));
      if (response.questions.length === 0) throw new Error("No questions matched.");
      // Warm up the speech engine while we still have the click gesture.
      if (options.voice) speech.speak([" "], { enabled: true });
      state.beginQuiz(response.sessionId, response.questions, options);
      navigate("/quiz");
    } catch (error) {
      status.set("error", errorMessage(error));
      startButton.disabled = false;
    }
  }
}

function setAll(inputs: Map<CategoryId, HTMLInputElement>, checked: boolean): void {
  for (const input of inputs.values()) input.checked = checked;
}

function renderStats(card: HTMLElement, stats: Stats | null, questions: QuestionsResponse | null): void {
  clear(card);
  card.appendChild(el("h2", { text: "Your progress" }));
  if (!stats) {
    card.appendChild(el("p", { class: "muted", text: "Progress could not be loaded." }));
    return;
  }
  const grid = el(
    "div",
    { class: "stat-grid" },
    stat(percent(stats.accuracy), "Overall accuracy", "stats-accuracy"),
    stat(String(stats.totalAttempted), "Questions answered", "stats-attempted"),
    stat(questions ? String(questions.counts.total) : "–", "Questions in bank", "stats-bank-size"),
  );
  card.appendChild(grid);
  if (stats.weakCategories.length > 0) {
    card.appendChild(el("h3", { text: "Weakest areas", attrs: { style: "margin-top:1rem" } }));
    const list = el("ul", { class: "list" });
    for (const id of stats.weakCategories) {
      const row = stats.byCategory.find((c) => c.category === id);
      list.appendChild(el("li", {}, el("span", { class: "item-title", text: safeCategoryName(id) }), el("span", { class: "item-meta", text: ` ${percent(row?.accuracy)} of ${row?.attempted ?? 0}` })));
    }
    card.appendChild(list);
  } else {
    card.appendChild(el("p", { class: "muted small", text: "Weak areas appear after at least three attempts in a category below 70%." }));
  }
  if (questions) {
    const by = questions.counts.bySource;
    card.appendChild(el("p", { class: "muted small", text: `Bank: ${by.bundled} bundled, ${by.ai} AI generated, ${by.imported} imported.` }));
  }
}

function stat(value: string, label: string, testid: string): HTMLElement {
  return el("div", { class: "stat", testid }, el("div", { class: "value", text: value }), el("div", { class: "label", text: label }));
}
