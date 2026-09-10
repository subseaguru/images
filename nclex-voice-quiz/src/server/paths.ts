/**
 * Filesystem locations resolved from this module's own URL, so they are correct whether the code
 * runs from `dist/src/server/*.js` or straight from `src/server/*.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `dist/` has no package.json of its own, so walking up until we find one lands on the project
// root from both the compiled and the source location.
function findProjectRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

export const PROJECT_ROOT = findProjectRoot(path.dirname(fileURLToPath(import.meta.url)));
export const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");
export const DEFAULT_DATA_DIR = path.join(PROJECT_ROOT, "data");
export const DEFAULT_SEED_DIR = path.join(PROJECT_ROOT, "data", "seed", "questions");

export function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
