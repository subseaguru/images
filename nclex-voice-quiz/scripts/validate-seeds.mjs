#!/usr/bin/env node
/**
 * Validates the bundled question bank in data/seed/questions/*.json (or the files given as
 * arguments) against the Question contract in src/shared/types.ts. Plain Node, no build needed:
 *   node scripts/validate-seeds.mjs
 * Exit code 1 when any problem is found.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const seedDir = join(here, "..", "data", "seed", "questions");

const CATEGORY_PREFIX = {
  management_of_care: "moc",
  safety_and_infection_control: "sic",
  health_promotion_and_maintenance: "hpm",
  psychosocial_integrity: "psi",
  basic_care_and_comfort: "bcc",
  pharmacological_and_parenteral_therapies: "ppt",
  reduction_of_risk_potential: "rrp",
  physiological_adaptation: "pa",
};
const CATEGORIES = Object.keys(CATEGORY_PREFIX);
const LABELS = ["A", "B", "C"];
const DIFFICULTIES = ["easy", "medium", "hard"];
const CJ_STEPS = [
  "recognize_cues", "analyze_cues", "prioritize_hypotheses",
  "generate_solutions", "take_action", "evaluate_outcomes",
];

const files = process.argv.length > 2
  ? process.argv.slice(2)
  : readdirSync(seedDir).filter((f) => f.endsWith(".json")).map((f) => join(seedDir, f));

const problems = [];
const seenIds = new Map();
const seenStems = new Map();
let total = 0;
const perCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));

for (const file of files) {
  const name = basename(file);
  let data;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    problems.push(`${name}: invalid JSON (${e.message})`);
    continue;
  }
  if (data.version !== 1 || !Array.isArray(data.questions)) {
    problems.push(`${name}: expected { version: 1, questions: [...] }`);
    continue;
  }
  const expectedCategory = name.replace(/\.json$/, "");
  data.questions.forEach((q, i) => {
    total += 1;
    const where = `${name}[${i}] ${q?.id ?? "(no id)"}`;
    const err = (msg) => problems.push(`${where}: ${msg}`);
    if (typeof q !== "object" || q === null) return err("not an object");
    if (typeof q.id !== "string" || !/^[a-z]+-\d{3}$/.test(q.id)) err("id must look like moc-001");
    if (seenIds.has(q.id)) err(`duplicate id (also in ${seenIds.get(q.id)})`); else seenIds.set(q.id, name);
    if (!CATEGORIES.includes(q.category)) err(`unknown category ${q.category}`);
    else {
      perCategory[q.category] += 1;
      if (CATEGORIES.includes(expectedCategory) && q.category !== expectedCategory) err(`category ${q.category} does not match file ${name}`);
      if (typeof q.id === "string" && !q.id.startsWith(CATEGORY_PREFIX[q.category] + "-")) err(`id prefix should be ${CATEGORY_PREFIX[q.category]}-`);
    }
    if (typeof q.stem !== "string" || q.stem.trim().length < 20) err("stem missing or too short");
    if (typeof q.stem === "string" && /[*_#`]/.test(q.stem)) err("stem contains markdown characters");
    const stemKey = typeof q.stem === "string" ? q.stem.trim().toLowerCase() : "";
    if (stemKey) { if (seenStems.has(stemKey)) err(`duplicate stem (also ${seenStems.get(stemKey)})`); else seenStems.set(stemKey, q.id); }
    if (!Array.isArray(q.options) || q.options.length !== 3) err("must have exactly 3 options");
    else {
      const texts = new Set();
      q.options.forEach((o, j) => {
        if (o?.label !== LABELS[j]) err(`option ${j} label must be ${LABELS[j]}`);
        if (typeof o?.text !== "string" || o.text.trim().length < 2) err(`option ${LABELS[j]} text missing`);
        if (typeof o?.rationale !== "string" || o.rationale.trim().length < 40) err(`option ${LABELS[j]} rationale missing or too short (< 40 chars)`);
        if (typeof o?.text === "string") {
          const t = o.text.trim().toLowerCase();
          if (texts.has(t)) err(`duplicate option text "${o.text}"`);
          texts.add(t);
        }
      });
    }
    if (!LABELS.includes(q.correct)) err(`correct must be A, B or C (got ${q.correct})`);
    if (typeof q.subtopic !== "string" || !q.subtopic.trim()) err("subtopic missing");
    if (q.clinicalJudgmentStep !== undefined && !CJ_STEPS.includes(q.clinicalJudgmentStep)) err(`unknown clinicalJudgmentStep ${q.clinicalJudgmentStep}`);
    if (!DIFFICULTIES.includes(q.difficulty)) err(`difficulty must be easy|medium|hard (got ${q.difficulty})`);
    if (q.source !== "bundled") err(`source must be "bundled" (got ${q.source})`);
    if (typeof q.teachingPoint !== "string" || q.teachingPoint.trim().length < 40) err("teachingPoint missing or too short");
    if (typeof q.createdAt !== "string" || Number.isNaN(Date.parse(q.createdAt))) err("createdAt must be an ISO-8601 date");
    for (const key of Object.keys(q)) {
      if (!["id","stem","options","correct","category","subtopic","clinicalJudgmentStep","difficulty","source","teachingPoint","references","tags","createdAt"].includes(key)) err(`unexpected field ${key}`);
    }
  });
}

console.log(`Checked ${total} questions in ${files.length} file(s).`);
for (const c of CATEGORIES) console.log(`  ${c.padEnd(42)} ${perCategory[c]}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(" - " + p);
  process.exit(1);
}
console.log("OK: all questions valid.");
