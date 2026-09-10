/**
 * Results of the last quiz: score, per-category accuracy for this session, missed questions with
 * rationales, and shortcuts to a weak-area quiz or a new one.
 */
import type { CategoryId } from "../../shared/types.js";
import { api, errorMessage } from "../api.js";
import type { Dispose } from "../router.js";
import { navigate } from "../router.js";
import * as state from "../state.js";
import { button, el, percent, questionDetails, safeCategoryName, statusBox } from "../ui.js";

export function resultsView(root: HTMLElement): Dispose {
  const results = state.getResults();
  const view = el("div", { class: "view stack" }, el("h1", { text: "Results" }));
  root.appendChild(view);
  if (!results) {
    view.appendChild(el("p", { text: "No finished quiz yet." }));
    view.appendChild(el("p", {}, el("a", { text: "Start one on the Home page.", attrs: { href: "#/" } })));
    return () => {};
  }

  const answered = results.answers.length;
  const correct = results.answers.filter((a) => a.isCorrect).length;
  const unsaved = results.answers.filter((a) => a.unsaved).length;
  const total = results.questions.length;
  const accuracy = answered > 0 ? correct / answered : null;
  const status = statusBox("results-status");

  const perCategory = new Map<CategoryId, { attempted: number; correct: number }>();
  for (const answer of results.answers) {
    const row = perCategory.get(answer.category) ?? { attempted: 0, correct: 0 };
    row.attempted += 1;
    if (answer.isCorrect) row.correct += 1;
    perCategory.set(answer.category, row);
  }
  const weak = [...perCategory.entries()].filter(([, row]) => row.correct / row.attempted < 0.7).map(([id]) => id);
  const missed = results.answers.filter((a) => !a.isCorrect);

  const summary = el(
    "section",
    { class: "card" },
    el("div", { class: "score", testid: "results-score", text: `${correct} / ${answered} correct (${percent(accuracy)})` }),
    el("p", { class: "muted", text: `${total} questions in the quiz, ${answered} answered, ${results.skipped.length} skipped.` }),
    unsaved > 0 ? el("div", { class: "notice warn", text: `${unsaved} answer(s) could not be saved to your progress because the server was unreachable.` }) : null,
    status.node,
    el(
      "div",
      { class: "row" },
      button(weak.length > 0 ? "Practice weak areas" : "Practice missed categories", () => practiceWeak(), {
        class: "primary",
        testid: "practice-weak",
        disabled: weak.length === 0 && missed.length === 0,
      }),
      button("New quiz", () => navigate("/"), { testid: "new-quiz" }),
    ),
  );

  const categories = el("section", { class: "card" }, el("h2", { text: "By category" }));
  if (perCategory.size === 0) categories.appendChild(el("p", { class: "muted", text: "Nothing answered." }));
  for (const [id, row] of perCategory) {
    const share = row.correct / row.attempted;
    categories.appendChild(
      el(
        "div",
        { class: "cat-row", testid: `results-category-${id}` },
        el("span", { text: safeCategoryName(id) }),
        el("span", { text: `${row.correct} / ${row.attempted} (${percent(share)})` }),
        el("div", { class: `bar ${share < 0.7 ? "low" : "high"}` }, el("span", { attrs: { style: `width:${Math.round(share * 100)}%` } })),
      ),
    );
  }

  const missedCard = el("section", { class: "card" }, el("h2", { text: missed.length > 0 ? `Missed questions (${missed.length})` : "No missed questions" }));
  for (const answer of missed) {
    const question = results.questions.find((q) => q.id === answer.questionId);
    if (!question) continue;
    missedCard.appendChild(questionDetails({ ...question, correct: answer.correct }, { open: true, summaryPrefix: `You answered ${answer.chosen}: ` }));
  }
  view.append(summary, categories, missedCard);

  let disposed = false;
  async function practiceWeak(): Promise<void> {
    const chosen = weak.length > 0 ? weak : [...new Set(missed.map((a) => a.category))];
    if (chosen.length === 0 || !results) return;
    status.set("info", "Selecting questions…");
    try {
      const options = { ...results.options, categories: chosen };
      const response = await api.startQuiz(state.quizRequest(results.questions.length, options));
      if (disposed) return;
      state.beginQuiz(response.sessionId, response.questions, options);
      navigate("/quiz");
    } catch (error) {
      if (!disposed) status.set("error", errorMessage(error));
    }
  }
  return () => {
    disposed = true;
  };
}
