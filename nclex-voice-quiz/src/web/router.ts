/**
 * Hash router. Each view renders synchronously into the main element and returns a dispose
 * function; the router calls it before rendering the next view so speech, timers and document
 * listeners never outlive their screen.
 */

export type Dispose = () => void;
export type View = (root: HTMLElement) => Dispose;

export interface Route {
  name: string;
  title: string;
  view: View;
}

const routes = new Map<string, Route>();
let current: { name: string; dispose: Dispose } | null = null;
let root: HTMLElement | null = null;

export function route(path: string, name: string, title: string, view: View): void {
  routes.set(path, { name, title, view });
}

export function navigate(path: string): void {
  const target = path.startsWith("#") ? path : `#${path}`;
  if (location.hash === target) render();
  else location.hash = target;
}

export function currentPath(): string {
  const hash = location.hash.replace(/^#/, "");
  const path = hash === "" ? "/" : hash;
  return path.split("?")[0] ?? "/";
}

function render(): void {
  if (!root) return;
  const path = currentPath();
  const match = routes.get(path) ?? routes.get("/");
  if (!match) return;
  if (current) {
    try {
      current.dispose();
    } catch (error) {
      console.error("View cleanup failed", error);
    }
    current = null;
  }
  while (root.firstChild) root.removeChild(root.firstChild);
  window.scrollTo({ top: 0 });
  document.title = `${match.title} - NCLEX Voice Quiz`;
  for (const link of document.querySelectorAll<HTMLAnchorElement>("[data-route]")) {
    if (link.dataset.route === match.name) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  const dispose = match.view(root);
  current = { name: match.name, dispose };
}

export function startRouter(mount: HTMLElement): void {
  root = mount;
  window.addEventListener("hashchange", render);
  render();
}
