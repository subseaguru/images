import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Every run starts from an empty data directory so counts, settings and attempts are predictable.
export default async function globalSetup(): Promise<void> {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  await rm(path.join(projectRoot, ".playwright-tmp", "data"), { recursive: true, force: true });
}
