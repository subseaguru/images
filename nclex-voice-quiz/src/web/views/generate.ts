/**
 * Generate: ask Claude for new questions grounded in the selected study sources.
 */
import type { ClinicalJudgmentStep, Difficulty, GenerateRequest, Question, StudySource } from "../../shared/types.js";
import { CLINICAL_JUDGMENT_STEPS, DIFFICULTIES } from "../../shared/types.js";
import { clinicalJudgmentStepName } from "../../shared/blueprint.js";
import { ApiError, api, errorMessage } from "../api.js";
import type { Dispose } from "../router.js";
import * as state from "../state.js";
import { append, button, categoryChecklist, checkbox, clear, difficultyLabel, el, field, formatChars, questionDetails, select } from "../ui.js";

export function generateView(root: HTMLElement): Dispose {
  let disposed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const view = el("div", { class: "view stack" }, el("h1", { text: "Generate questions with Claude" }));
  root.appendChild(view);

  const count = el("input", { testid: "generate-count", attrs: { type: "number", min: "1", max: "20", step: "1" } });
  count.value = "5";
  const followBlueprint = checkbox("Follow the NCLEX blueprint (all categories, weighted)", { checked: true, testid: "generate-blueprint" });
  const categories = categoryChecklist("generate-category", () => false);
  categories.node.hidden = true;
  followBlueprint.input.addEventListener("change", () => {
    categories.node.hidden = followBlueprint.input.checked;
  });
  const difficulty = select(
    [{ value: "", label: "Mixed" }, ...DIFFICULTIES.map((d) => ({ value: d, label: difficultyLabel(d) }))],
    "",
    "generate-difficulty",
  );
  const stepInputs = new Map<ClinicalJudgmentStep, HTMLInputElement>();
  const stepsNode = el("div", { class: "checks" });
  for (const step of CLINICAL_JUDGMENT_STEPS) {
    const box = checkbox(clinicalJudgmentStepName(step), { value: step });
    stepInputs.set(step, box.input);
    stepsNode.appendChild(box.wrapper);
  }
  const sourcesNode = el("div", { class: "checks" }, el("p", { class: "muted small", text: "Loading study sources…" }));
  const sourceInputs = new Map<string, HTMLInputElement>();
  const research = checkbox("Let Claude research online (current NCSBN and clinical guidance)", { checked: false, testid: "generate-research" });
  const weak = checkbox("Target my weak areas", { checked: false, testid: "generate-weak" });
  const focus = el("input", { testid: "generate-focus", attrs: { type: "text", placeholder: "e.g. insulin types and peak times" } });

  const submit = button("Generate", () => run(), { class: "primary large", testid: "generate-submit", type: "submit" });
  const submitSlot = el("div", { class: "row" });
  const status = el("div", { class: "notice", testid: "generate-status", attrs: { "aria-live": "polite", role: "status" } });
  const result = el("section", { testid: "generate-result" });

  const form = el("form", { class: "card stack" });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    run();
  });
  append(
    form,
    field("How many questions", count, "1 to 20 per run; each run takes one to three minutes."),
    el("fieldset", {}, el("legend", { text: "Categories" }), followBlueprint.wrapper, categories.node),
    field("Difficulty", difficulty),
    el("fieldset", {}, el("legend", { text: "Clinical-judgment step (optional)" }), stepsNode),
    el("fieldset", {}, el("legend", { text: "Ground the questions in these study sources" }), sourcesNode),
    research.wrapper,
    weak.wrapper,
    field("Focus (optional)", focus, "A topic, drug class, care setting or anything else to concentrate on."),
    status,
    submitSlot,
  );
  view.append(form, result);

  state.loadSettings().then((settings) => {
    if (disposed) return;
    renderSubmit(settings.hasApiKey);
  });
  api.sources().then(
    (response) => {
      if (disposed) return;
      renderSources(response.sources);
    },
    (error: unknown) => {
      if (disposed) return;
      clear(sourcesNode);
      sourcesNode.appendChild(el("p", { class: "muted small", text: `Study sources could not be loaded: ${errorMessage(error)}` }));
    },
  );

  function renderSubmit(hasApiKey: boolean): void {
    clear(submitSlot);
    if (hasApiKey) {
      submitSlot.appendChild(submit);
      return;
    }
    submitSlot.appendChild(noKeyCallout());
  }

  function noKeyCallout(): HTMLElement {
    return el(
      "div",
      { class: "notice warn", testid: "generate-no-key" },
      el("strong", { text: "No Anthropic API key is configured. " }),
      "Add one under ",
      el("a", { text: "Settings", attrs: { href: "#/settings" } }),
      " to generate questions.",
    );
  }

  function renderSources(sources: StudySource[]): void {
    clear(sourcesNode);
    if (sources.length === 0) {
      sourcesNode.appendChild(el("p", { class: "muted small" }, "No study sources yet. Add notes, a URL or a file under ", el("a", { text: "Sources", attrs: { href: "#/sources" } }), "."));
      return;
    }
    for (const source of sources) {
      const box = checkbox(source.name, { value: source.id, extra: formatChars(source.chars) });
      sourceInputs.set(source.id, box.input);
      sourcesNode.appendChild(box.wrapper);
    }
  }

  async function run(): Promise<void> {
    if (submit.disabled) return;
    const n = Math.min(20, Math.max(1, Math.round(Number(count.value) || 5)));
    count.value = String(n);
    const body: GenerateRequest = { count: n };
    if (!followBlueprint.input.checked) {
      const chosen = categories.selected();
      if (chosen.length > 0) body.categories = chosen;
    }
    if (difficulty.value) body.difficulty = difficulty.value as Difficulty;
    const steps = [...stepInputs.entries()].filter(([, input]) => input.checked).map(([id]) => id);
    if (steps.length > 0) body.clinicalJudgmentSteps = steps;
    const sourceIds = [...sourceInputs.entries()].filter(([, input]) => input.checked).map(([id]) => id);
    if (sourceIds.length > 0) body.sourceIds = sourceIds;
    if (research.input.checked) body.research = true;
    if (weak.input.checked) body.targetWeakAreas = true;
    if (focus.value.trim()) body.focus = focus.value.trim();

    submit.disabled = true;
    clear(result);
    const startedAt = Date.now();
    const tick = () => {
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      status.className = "notice";
      status.textContent = `Generating ${n} question${n === 1 ? "" : "s"}… ${seconds}s elapsed (this can take one to three minutes).`;
    };
    tick();
    timer = setInterval(tick, 1000);
    try {
      const response = await api.generate(body);
      if (disposed) return;
      status.className = "notice success";
      status.textContent = `Generated ${response.questions.length} question${response.questions.length === 1 ? "" : "s"} in ${Math.round((Date.now() - startedAt) / 1000)}s with ${response.model}.`;
      renderResult(response.questions, response.researchBrief, response.usage, response.warnings);
    } catch (error) {
      if (disposed) return;
      if (error instanceof ApiError && error.code === "no_api_key") {
        status.className = "notice";
        status.textContent = "";
        renderSubmit(false);
      } else {
        status.className = "notice error";
        status.textContent = errorMessage(error);
      }
    } finally {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      submit.disabled = false;
    }
  }

  function renderResult(
    questions: Question[],
    brief: string | undefined,
    usage: { inputTokens: number; outputTokens: number },
    warnings: string[],
  ): void {
    clear(result);
    const card = el("div", { class: "card stack" });
    for (const warning of warnings) card.appendChild(el("div", { class: "notice warn", text: warning }));
    card.appendChild(el("h2", { text: `New questions (${questions.length})` }));
    if (questions.length === 0) card.appendChild(el("p", { class: "muted", text: "No valid questions came back this time; try again or narrow the focus." }));
    for (const question of questions) card.appendChild(questionDetails(question));
    if (brief) {
      card.appendChild(el("details", { class: "q" }, el("summary", { text: "Research brief" }), el("pre", { class: "wrap", text: brief })));
    }
    card.appendChild(el("p", { class: "muted small", text: `Token usage: ${usage.inputTokens.toLocaleString()} input, ${usage.outputTokens.toLocaleString()} output.` }));
    card.appendChild(el("p", {}, el("a", { text: "Browse the bank", attrs: { href: "#/bank" } })));
    result.appendChild(card);
  }

  return () => {
    disposed = true;
    if (timer !== undefined) clearInterval(timer);
  };
}
