/**
 * Question bank: filter, browse, delete AI/imported questions, import and export JSON.
 */
import type { CategoryId, Question, QuestionSource } from "../../shared/types.js";
import { CATEGORY_IDS, QUESTION_SOURCES } from "../../shared/types.js";
import { api, ApiError, errorMessage } from "../api.js";
import type { QuestionsResponse } from "../api.js";
import { navigate } from "../router.js";
import type { Dispose } from "../router.js";
import { button, chip, clear, debounce, el, questionDetails, safeCategoryName, select, sourceLabel, statusBox } from "../ui.js";

const PAGE_SIZE = 50;

export function bankView(root: HTMLElement): Dispose {
  let disposed = false;
  let objectUrl: string | null = null;
  const view = el("div", { class: "view stack" }, el("h1", { text: "Question bank" }));
  root.appendChild(view);

  const status = statusBox("bank-status");
  const category = select([{ value: "", label: "All categories" }, ...CATEGORY_IDS.map((id) => ({ value: id, label: safeCategoryName(id) }))], "", "bank-category");
  const source = select([{ value: "", label: "All sources" }, ...QUESTION_SOURCES.map((s) => ({ value: s, label: sourceLabel(s) }))], "", "bank-source");
  const search = el("input", { testid: "bank-search", attrs: { type: "search", placeholder: "Search stems and options…", "aria-label": "Search questions" } });
  const reviewOnly = el("input", { testid: "bank-needs-review", attrs: { type: "checkbox", id: "bank-needs-review" } });
  const reviewToggle = el("label", { class: "inline" }, reviewOnly, " Needs review only");
  const enrichAll = button("Enrich with Claude", () => void enrich({ all: true }), { testid: "bank-enrich-all", class: "small" });
  enrichAll.hidden = true;
  const summary = el("p", { class: "muted small", testid: "bank-summary" });
  const list = el("div", { testid: "bank-list" });
  const more = button("Show more", () => renderPage(), { class: "small" });
  more.hidden = true;

  const importInput = el("input", { testid: "bank-import-file", attrs: { type: "file", accept: ".json,application/json" } });
  importInput.addEventListener("change", () => {
    const file = importInput.files?.[0];
    if (file) importFile(file);
  });
  const importLabel = el("label", { class: "btn" }, "Import JSON…", importInput);
  importInput.style.display = "none";
  const exportButton = button("Export JSON", () => exportBank(), { testid: "bank-export" });
  const exportLink = el("a", { class: "btn", text: "Download nclex-questions.json", testid: "bank-export-link" });
  exportLink.hidden = true;

  view.append(
    el(
      "section",
      { class: "card stack" },
      el("div", { class: "row" }, el("div", { class: "field", attrs: { style: "flex:1;margin:0" } }, search), category, source),
      el("div", { class: "row" }, reviewToggle, enrichAll),
      el(
        "div",
        { class: "row" },
        importLabel,
        exportButton,
        exportLink,
        el(
          "span",
          { class: "muted small" },
          "Import accepts the app's own format and question sets written by other tools (see docs/IMPORT_FORMAT.md); anything missing a category or rationales is flagged for review.",
        ),
      ),
      status.node,
    ),
    el("section", { class: "card" }, summary, list, more),
  );

  let filtered: Question[] = [];
  let shown = 0;
  /** Concerns from the last enrichment run, shown next to the questions they belong to. */
  const concerns = new Map<string, string>();

  const load = async (): Promise<void> => {
    try {
      const response = await api.questions({
        category: category.value ? [category.value as CategoryId] : undefined,
        source: source.value ? [source.value as QuestionSource] : undefined,
        q: search.value.trim() || undefined,
        needsReview: reviewOnly.checked || undefined,
      });
      if (disposed) return;
      render(response);
    } catch (error) {
      if (!disposed) status.set("error", `Questions could not be loaded: ${errorMessage(error)}`);
    }
  };
  const debouncedLoad = debounce(() => void load(), 250);
  search.addEventListener("input", debouncedLoad);
  category.addEventListener("change", () => void load());
  source.addEventListener("change", () => void load());
  reviewOnly.addEventListener("change", () => void load());
  void load();

  function render(response: QuestionsResponse): void {
    filtered = response.questions;
    shown = 0;
    clear(list);
    const counts = response.counts;
    const flaggedCount = response.questions.filter((q) => q.needsReview).length;
    summary.textContent = `${filtered.length} shown of ${counts.total} in the bank (${counts.bySource.bundled} bundled, ${counts.bySource.ai} AI generated, ${counts.bySource.imported} imported).`;
    // "Enrich all" only appears when the current view actually contains flagged questions.
    enrichAll.hidden = flaggedCount === 0;
    enrichAll.textContent = `Enrich ${flaggedCount} question${flaggedCount === 1 ? "" : "s"} with Claude`;
    if (filtered.length === 0) list.appendChild(el("p", { class: "muted", text: "No questions match." }));
    renderPage();
  }

  function renderPage(): void {
    const slice = filtered.slice(shown, shown + PAGE_SIZE);
    for (const question of slice) {
      const actions: HTMLElement[] = [];
      if (question.needsReview) {
        actions.push(
          button("Enrich with Claude", () => void enrich({ ids: [question.id] }), {
            class: "small",
            testid: `bank-enrich-${question.id}`,
          }),
        );
      }
      if (question.source !== "bundled") {
        actions.push(button("Delete", () => remove(question), { class: "small danger", testid: `bank-delete-${question.id}` }));
      }
      const details = questionDetails(question, { actions, testid: `bank-question-${question.id}` });
      if (question.needsReview) {
        const badge = chip("Needs review");
        badge.classList.add("warn");
        badge.dataset.testid = `bank-flag-${question.id}`;
        badge.title = "Imported without a category or without a rationale for every option.";
        details.querySelector("summary")?.appendChild(badge);
      }
      const concern = concerns.get(question.id);
      if (concern) {
        details.appendChild(el("div", { class: "notice warn", testid: `bank-concern-${question.id}` }, `Claude's concern: ${concern}`));
        details.open = true;
      }
      list.appendChild(details);
    }
    shown += slice.length;
    more.hidden = shown >= filtered.length;
  }

  async function remove(question: Question): Promise<void> {
    if (!confirm("Delete this question from the bank? Past attempts are kept.")) return;
    try {
      await api.deleteQuestion(question.id);
      if (disposed) return;
      status.set("success", "Question deleted.");
      await load();
    } catch (error) {
      if (!disposed) status.set("error", errorMessage(error));
    }
  }

  async function importFile(file: File): Promise<void> {
    status.set("info", `Importing ${file.name}…`);
    try {
      const raw = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`${file.name} is not valid JSON.`);
      }
      // Sent as-is: the server repairs whatever shape the other tool produced.
      const report = await api.importQuestions(parsed as Question[]);
      if (disposed) return;
      const lines = [`Imported ${report.imported} question${report.imported === 1 ? "" : "s"}.`];
      if (report.skippedDuplicates > 0) lines.push(`${report.skippedDuplicates} were already in the bank and were skipped.`);
      if (report.needsReview > 0) {
        lines.push(`${report.needsReview} need review: tick "Needs review only" and use Enrich with Claude to fill in the gaps.`);
      }
      for (const item of report.dropped) {
        lines.push(`Question ${item.index + 1} had more than three options; dropped: ${item.options.join(" | ")}`);
      }
      for (const item of report.rejected) lines.push(`Question ${item.index + 1} rejected: ${item.errors.join("; ")}`);
      status.set(report.rejected.length > 0 ? "warn" : "success", lines.join("\n"));
      status.node.style.whiteSpace = "pre-wrap";
      await load();
    } catch (error) {
      if (!disposed) status.set("error", errorMessage(error));
    } finally {
      importInput.value = "";
    }
  }

  /**
   * Ask Claude to fill in the classification and rationales a question set arrived without. It
   * never changes the question, its options or the keyed answer; anything Claude is unsure about
   * comes back as a concern shown against that question.
   */
  async function enrich(target: { ids: string[] } | { all: true }): Promise<void> {
    const single = "ids" in target;
    enrichAll.disabled = true;
    status.set("info", single ? "Asking Claude to fill in this question…" : "Asking Claude to fill in the flagged questions… this can take a few minutes.");
    status.node.style.whiteSpace = "pre-wrap";
    try {
      const result = await api.enrichQuestions(target);
      if (disposed) return;
      concerns.clear();
      for (const item of result.flagged) concerns.set(item.id, item.concern);
      const lines = [`Completed ${result.updated} question${result.updated === 1 ? "" : "s"}.`];
      if (result.flagged.length > 0) {
        lines.push(`${result.flagged.length} left unchanged because Claude had a concern; they are shown below.`);
      }
      for (const warning of result.warnings) lines.push(warning);
      lines.push(`Used ${result.usage.inputTokens.toLocaleString()} input and ${result.usage.outputTokens.toLocaleString()} output tokens.`);
      status.set(result.flagged.length > 0 || result.warnings.length > 0 ? "warn" : "success", lines.join("\n"));
      await load();
    } catch (error) {
      if (disposed) return;
      if (error instanceof ApiError && error.code === "no_api_key") {
        status.set("error", "Enriching needs a Claude API key. Add one in Settings.");
        view.appendChild(el("p", {}, button("Open Settings", () => navigate("#/settings"), { testid: "bank-enrich-settings" })));
        return;
      }
      status.set("error", errorMessage(error));
    } finally {
      enrichAll.disabled = false;
    }
  }

  async function exportBank(): Promise<void> {
    exportButton.disabled = true;
    try {
      const response = await api.questions();
      if (disposed) return;
      const blob = new Blob([JSON.stringify({ version: 1, questions: response.questions }, null, 2)], { type: "application/json" });
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(blob);
      exportLink.href = objectUrl;
      exportLink.download = "nclex-questions.json";
      exportLink.hidden = false;
      exportLink.click();
      status.set("success", `Prepared ${response.questions.length} questions for download.`);
    } catch (error) {
      if (!disposed) status.set("error", errorMessage(error));
    } finally {
      exportButton.disabled = false;
    }
  }

  return () => {
    disposed = true;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };
}
