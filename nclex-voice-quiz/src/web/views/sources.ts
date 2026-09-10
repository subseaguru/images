/**
 * Study sources: paste text, add a URL or upload a file; list, preview and delete.
 */
import type { StudySource } from "../../shared/types.js";
import { api, errorMessage } from "../api.js";
import type { Dispose } from "../router.js";
import { append, button, clear, el, field, formatChars, formatDate, statusBox } from "../ui.js";

export function sourcesView(root: HTMLElement): Dispose {
  let disposed = false;
  const view = el("div", { class: "view stack" }, el("h1", { text: "Study sources" }));
  root.appendChild(view);
  const status = statusBox("source-status");
  const list = el("ul", { class: "list", testid: "source-list" });

  // Paste text
  const name = el("input", { testid: "source-name", attrs: { type: "text", placeholder: "e.g. Pharmacology lecture notes" } });
  const text = el("textarea", { testid: "source-text", attrs: { placeholder: "Paste notes, a transcript, a chapter…" } });
  const addText = button("Add text", () => submitText(), { class: "primary", testid: "source-add-text" });
  const textForm = el("form", { class: "stack" });
  textForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitText();
  });
  append(textForm, field("Name", name), field("Text", text), el("div", { class: "row" }, addText));

  // URL
  const url = el("input", { testid: "source-url", attrs: { type: "url", placeholder: "https://…" } });
  const addUrl = button("Add URL", () => submitUrl(), { class: "primary", testid: "source-add-url" });
  const urlForm = el("form", { class: "stack" });
  urlForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitUrl();
  });
  append(urlForm, field("Web page", url, "The page text is fetched once and stored; scripts and markup are stripped."), el("div", { class: "row" }, addUrl));

  // File upload
  const file = el("input", { testid: "source-file", attrs: { type: "file", accept: ".txt,.md,.pdf,.html,.htm,.csv,text/plain,text/markdown,application/pdf,text/html" } });
  file.addEventListener("change", () => {
    const chosen = file.files?.[0];
    if (chosen) upload(chosen);
  });
  const fileForm = el("div", { class: "stack" }, field("Upload a file", file, ".txt, .md, .pdf, .html or .csv, up to 25 MB."));

  view.append(
    el("div", { class: "grid-2" }, el("section", { class: "card" }, el("h2", { text: "Paste text" }), textForm), el("section", { class: "card stack" }, el("div", {}, el("h2", { text: "Add a web page" }), urlForm), el("div", {}, el("h2", { text: "Upload a file" }), fileForm))),
    status.node,
    el("section", { class: "card" }, el("h2", { text: "Your sources" }), list),
  );
  refresh();

  async function submitText(): Promise<void> {
    if (!name.value.trim() || !text.value.trim()) {
      status.set("error", "Both a name and some text are needed.");
      return;
    }
    addText.disabled = true;
    try {
      const source = await api.addTextSource(name.value.trim(), text.value);
      if (disposed) return;
      name.value = "";
      text.value = "";
      status.set("success", `Added “${source.name}” (${formatChars(source.chars)}).`);
      await refresh();
    } catch (error) {
      if (!disposed) status.set("error", errorMessage(error));
    } finally {
      addText.disabled = false;
    }
  }

  async function submitUrl(): Promise<void> {
    if (!url.value.trim()) {
      status.set("error", "Enter a URL.");
      return;
    }
    addUrl.disabled = true;
    status.set("info", "Fetching the page…");
    try {
      const source = await api.addUrlSource(url.value.trim());
      if (disposed) return;
      url.value = "";
      status.set("success", `Added “${source.name}” (${formatChars(source.chars)}).`);
      await refresh();
    } catch (error) {
      if (!disposed) status.set("error", errorMessage(error));
    } finally {
      addUrl.disabled = false;
    }
  }

  async function upload(chosen: File): Promise<void> {
    file.disabled = true;
    status.set("info", `Uploading ${chosen.name}…`);
    try {
      const source = await api.uploadSource(chosen);
      if (disposed) return;
      status.set("success", `Added “${source.name}” (${formatChars(source.chars)}).`);
      await refresh();
    } catch (error) {
      if (!disposed) status.set("error", errorMessage(error));
    } finally {
      file.disabled = false;
      file.value = "";
    }
  }

  async function refresh(): Promise<void> {
    try {
      const response = await api.sources();
      if (disposed) return;
      renderList(response.sources);
    } catch (error) {
      if (!disposed) status.set("error", `Sources could not be loaded: ${errorMessage(error)}`);
    }
  }

  function renderList(sources: StudySource[]): void {
    clear(list);
    if (sources.length === 0) {
      list.appendChild(el("li", { class: "muted", text: "No study sources yet." }));
      return;
    }
    for (const source of sources) list.appendChild(sourceItem(source));
  }

  function sourceItem(source: StudySource): HTMLElement {
    const previewSlot = el("div", { class: "small" });
    const previewButton = button("Preview", () => togglePreview(), { class: "small" });
    const kindLabel = source.kind === "url" ? "Web page" : source.kind === "file" ? "File" : "Text";
    const item = el(
      "li",
      { testid: `source-${source.id}` },
      el("div", { class: "row between" }, el("span", { class: "item-title", text: source.name }), el("span", { class: "row" }, previewButton, button("Delete", () => remove(source), { class: "small danger", testid: `source-delete-${source.id}` }))),
      el("div", { class: "item-meta", text: `${kindLabel} · ${formatChars(source.chars)} · added ${formatDate(source.addedAt)}${source.url ? ` · ${source.url}` : ""}` }),
      el("div", { class: "muted small", text: source.preview }),
      previewSlot,
    );
    let open = false;
    async function togglePreview(): Promise<void> {
      open = !open;
      clear(previewSlot);
      previewButton.textContent = open ? "Hide" : "Preview";
      if (!open) return;
      previewSlot.appendChild(el("p", { class: "muted", text: "Loading…" }));
      try {
        const full = await api.source(source.id);
        if (disposed || !open) return;
        clear(previewSlot);
        const excerpt = full.text.length > 4000 ? `${full.text.slice(0, 4000)}\n…` : full.text;
        previewSlot.appendChild(el("pre", { class: "wrap card", text: excerpt }));
      } catch (error) {
        clear(previewSlot);
        previewSlot.appendChild(el("p", { class: "notice error", text: errorMessage(error) }));
      }
    }
    return item;
  }

  async function remove(source: StudySource): Promise<void> {
    if (!confirm(`Delete “${source.name}”? Questions already generated from it are kept.`)) return;
    try {
      await api.deleteSource(source.id);
      if (disposed) return;
      status.set("success", `Deleted “${source.name}”.`);
      await refresh();
    } catch (error) {
      if (!disposed) status.set("error", errorMessage(error));
    }
  }

  return () => {
    disposed = true;
  };
}
