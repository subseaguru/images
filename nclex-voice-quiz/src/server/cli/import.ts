#!/usr/bin/env node
/**
 * Command-line import: `npm run import -- file1.json file2.json`
 *
 * Same pipeline as the Bank page's Import button (the server and the command line cannot drift),
 * but convenient for a folder full of files - a few hundred questions from another tool, say.
 * Writes into the same data directory the app reads (DATA_DIR, default ./data).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { importQuestions } from "../questions/import.js";
import { QuestionStore } from "../questions/store.js";
import { DEFAULT_DATA_DIR, DEFAULT_SEED_DIR } from "../paths.js";

async function main(argv: string[]): Promise<number> {
  const files = argv.filter((arg) => !arg.startsWith("-"));
  if (files.length === 0) {
    console.error("Usage: npm run import -- <file.json> [more.json ...]");
    console.error("Imports question files into the app's bank (DATA_DIR, default ./data).");
    return 2;
  }

  const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : DEFAULT_DATA_DIR;
  const seedDir = process.env.SEED_DIR ? path.resolve(process.env.SEED_DIR) : DEFAULT_SEED_DIR;
  // The store loads the seed bank and the learner's own questions in its constructor.
  const store = new QuestionStore({ seedDir, dataFile: path.join(dataDir, "questions.json") });
  console.log(`Bank: ${store.size()} questions (data directory: ${dataDir})`);

  let failures = 0;
  for (const file of files) {
    const name = path.basename(file);
    let payload: unknown;
    try {
      payload = JSON.parse(await readFile(file, "utf8"));
    } catch (err) {
      console.error(`${name}: could not read the file - ${err instanceof Error ? err.message : String(err)}`);
      failures += 1;
      continue;
    }
    try {
      const report = await importQuestions(payload, store);
      const parts = [`imported ${report.imported}`];
      if (report.skippedDuplicates > 0) parts.push(`${report.skippedDuplicates} already in the bank`);
      if (report.needsReview > 0) parts.push(`${report.needsReview} need review`);
      if (report.rejected.length > 0) parts.push(`${report.rejected.length} rejected`);
      console.log(`${name}: ${parts.join(", ")}`);
      for (const item of report.rejected) {
        console.log(`  - question ${item.index + 1}: ${item.errors.join("; ")}`);
      }
      for (const item of report.dropped) {
        console.log(`  - question ${item.index + 1}: dropped extra option(s): ${item.options.join(" | ")}`);
      }
      // A rejected question is reported, not a failed run: the rest of the file still imported.
    } catch (err) {
      console.error(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      failures += 1;
    }
  }

  console.log(`Bank now holds ${store.size()} questions.`);
  console.log('Questions that need review can be completed in the app: Bank -> "needs review" -> Enrich with Claude.');
  // Non-zero only when a whole file could not be read or imported.
  return failures > 0 ? 1 : 0;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
