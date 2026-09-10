/**
 * Small DOM helpers. All text goes through `textContent`, so user- and API-supplied strings are
 * never interpreted as HTML.
 */
import type { CategoryId, Difficulty, OptionLabel, QuestionSource } from "../shared/types.js";
import { categoryName } from "../shared/blueprint.js";
import { errorMessage } from "./api.js";

type Child = Node | string | number | null | undefined | false;

export interface ElOptions {
  class?: string;
  text?: string;
  testid?: string;
  attrs?: Record<string, string | undefined>;
  on?: Partial<Record<keyof HTMLElementEventMap, (event: Event) => void>>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElOptions = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.testid) node.dataset.testid = options.testid;
  if (options.attrs) {
    for (const [name, value] of Object.entries(options.attrs)) {
      if (value !== undefined) node.setAttribute(name, value);
    }
  }
  if (options.on) {
    for (const [name, handler] of Object.entries(options.on)) {
      if (handler) node.addEventListener(name, handler as EventListener);
    }
  }
  append(node, ...children);
  return node;
}

export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
  }
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function button(
  label: string,
  onClick: (event: MouseEvent) => void,
  options: { class?: string; testid?: string; type?: "button" | "submit"; disabled?: boolean; title?: string } = {},
): HTMLButtonElement {
  const node = el("button", {
    class: `btn ${options.class ?? ""}`.trim(),
    text: label,
    testid: options.testid,
    attrs: { type: options.type ?? "button", title: options.title },
  });
  node.disabled = options.disabled === true;
  node.addEventListener("click", onClick);
  return node;
}

export function checkbox(
  label: string,
  options: { checked?: boolean; testid?: string; value?: string; name?: string; extra?: string } = {},
): { wrapper: HTMLLabelElement; input: HTMLInputElement } {
  const input = el("input", { testid: options.testid, attrs: { type: "checkbox", value: options.value, name: options.name } });
  input.checked = options.checked === true;
  const wrapper = el("label", { class: "check" }, input, el("span", { text: label }));
  if (options.extra) append(wrapper, el("span", { class: "pct", text: options.extra }));
  return { wrapper, input };
}

export function field(labelText: string, control: HTMLElement, hint?: string): HTMLDivElement {
  const id = control.id || `f-${Math.random().toString(36).slice(2, 9)}`;
  control.id = id;
  const wrapper = el("div", { class: "field" }, el("label", { text: labelText, attrs: { for: id } }), control);
  if (hint) append(wrapper, el("div", { class: "hint", text: hint }));
  return wrapper;
}

export function select(options: { value: string; label: string }[], selected?: string, testid?: string): HTMLSelectElement {
  const node = el("select", { testid });
  for (const option of options) {
    const item = el("option", { text: option.label, attrs: { value: option.value } });
    if (option.value === selected) item.selected = true;
    node.appendChild(item);
  }
  return node;
}

export function notice(kind: "info" | "error" | "warn" | "success", text: string, testid?: string): HTMLDivElement {
  return el("div", { class: `notice ${kind === "info" ? "" : kind}`.trim(), text, testid, attrs: { role: kind === "error" ? "alert" : "status" } });
}

/** A notice slot that can be updated in place; empty text hides it. */
export function statusBox(testid?: string): { node: HTMLDivElement; set: (kind: "info" | "error" | "warn" | "success", text: string) => void; clear: () => void } {
  const node = el("div", { class: "notice", testid, attrs: { "aria-live": "polite" } });
  return {
    node,
    set(kind, text) {
      node.className = `notice ${kind === "info" ? "" : kind}`.trim();
      node.textContent = text;
    },
    clear() {
      node.textContent = "";
    },
  };
}

export function chip(text: string, neutral = false): HTMLSpanElement {
  return el("span", { class: neutral ? "chip neutral" : "chip", text });
}

export function percent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatChars(chars: number): string {
  if (chars >= 1_000_000) return `${(chars / 1_000_000).toFixed(1)}M chars`;
  if (chars >= 1_000) return `${(chars / 1_000).toFixed(1)}k chars`;
  return `${chars} chars`;
}

export function safeCategoryName(id: string): string {
  try {
    return categoryName(id as CategoryId);
  } catch {
    return id;
  }
}

export function sourceLabel(source: QuestionSource): string {
  return source === "ai" ? "AI generated" : source === "imported" ? "Imported" : "Bundled";
}

export function difficultyLabel(difficulty: Difficulty): string {
  return difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
}

export function optionLabelText(label: OptionLabel): string {
  return label;
}

export function describeError(error: unknown): string {
  return errorMessage(error);
}

/** True when a keyboard event originates from a text-entry control (shortcuts must stay quiet). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Focus without scrolling the page jumpily; ignores detached nodes. */
export function focus(node: HTMLElement | null | undefined): void {
  if (!node || !node.isConnected) return;
  try {
    node.focus({ preventScroll: false });
  } catch {
    // Some elements refuse focus; nothing to do.
  }
}
