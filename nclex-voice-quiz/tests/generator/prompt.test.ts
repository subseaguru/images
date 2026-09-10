import { test } from "node:test";
import assert from "node:assert/strict";
import { CATEGORY_IDS } from "../../src/shared/types.js";
import type { Stats } from "../../src/shared/types.js";
import { NCLEX_RN_BLUEPRINT, blueprintDistribution } from "../../src/shared/blueprint.js";
import {
  buildResearchUserMessage,
  buildSystemBlocks,
  buildUserMessage,
  clampCount,
  planCategoryCounts,
  prepareSources,
  renderBlueprint,
  weakAreasFrom,
} from "../../src/server/generator/prompt.js";

const emptyCounts = () => Object.fromEntries(CATEGORY_IDS.map((id) => [id, 0])) as Record<(typeof CATEGORY_IDS)[number], number>;

test("renderBlueprint lists every subcategory with its range, description and activity statements", () => {
  const text = renderBlueprint();
  for (const c of NCLEX_RN_BLUEPRINT.categories) {
    assert.ok(text.includes(`${c.name} [id: ${c.id}]`), c.id);
    assert.ok(text.includes(`${c.minPercent} to ${c.maxPercent} percent`), c.id);
    assert.ok(text.includes(c.description));
    for (const s of c.activityStatements) assert.ok(text.includes(`- ${s}`), s);
  }
  for (const s of NCLEX_RN_BLUEPRINT.clinicalJudgmentSteps) assert.ok(text.includes(`${s.id} (${s.name})`));
  for (const p of NCLEX_RN_BLUEPRINT.integratedProcesses) assert.ok(text.includes(p));
  assert.ok(text.includes(NCLEX_RN_BLUEPRINT.examFormat));
});

test("system blocks carry the rules and a cache breakpoint on the last block", () => {
  const blocks = buildSystemBlocks();
  assert.ok(blocks.length >= 1);
  const last = blocks[blocks.length - 1]!;
  assert.deepEqual(last.cache_control, { type: "ephemeral" });
  const all = blocks.map((b) => b.text).join("\n");
  for (const phrase of [
    "expert NCLEX-RN item writer",
    "one clearly best answer",
    "30 to 70 words",
    "all of the above",
    "select all that apply",
    "Expand abbreviations",
    "0.5 milligrams",
    "Balance the correct label across A, B and C",
    "activity statements",
  ]) {
    assert.ok(all.toLowerCase().includes(phrase.toLowerCase()), phrase);
  }
});

test("clampCount keeps the request within 1..20", () => {
  assert.equal(clampCount(0), 1);
  assert.equal(clampCount(25), 20);
  assert.equal(clampCount(7.4), 7);
  assert.equal(clampCount(Number.NaN), 10);
});

test("planCategoryCounts follows the blueprint when no categories are given", () => {
  assert.deepEqual(planCategoryCounts(10, undefined), blueprintDistribution(10));
  assert.deepEqual(planCategoryCounts(6, []), blueprintDistribution(6));
});

test("planCategoryCounts restricts to the requested categories", () => {
  const counts = planCategoryCounts(5, ["management_of_care", "basic_care_and_comfort"]);
  assert.equal(counts.management_of_care + counts.basic_care_and_comfort, 5);
  for (const id of CATEGORY_IDS) {
    if (id !== "management_of_care" && id !== "basic_care_and_comfort") assert.equal(counts[id], 0);
  }
});

test("planCategoryCounts moves up to 40% of the batch toward weak areas without emptying a category", () => {
  const base = blueprintDistribution(10);
  const counts = planCategoryCounts(10, undefined, [{ category: "psychosocial_integrity", accuracy: 0.4 }]);
  const total = CATEGORY_IDS.reduce((sum, id) => sum + counts[id], 0);
  assert.equal(total, 10);
  assert.ok(counts.psychosocial_integrity > base.psychosocial_integrity);
  assert.ok(counts.psychosocial_integrity - base.psychosocial_integrity <= 4);
  for (const id of CATEGORY_IDS) if (base[id] > 0) assert.ok(counts[id] >= 1, id);
});

test("planCategoryCounts gives a weak category at least one question even in a small batch", () => {
  assert.equal(blueprintDistribution(6).psychosocial_integrity, 0);
  const counts = planCategoryCounts(6, undefined, [{ category: "psychosocial_integrity", accuracy: 0.2 }]);
  assert.equal(counts.psychosocial_integrity, 1);
  assert.equal(CATEGORY_IDS.reduce((sum, id) => sum + counts[id], 0), 6);
});

test("weakAreasFrom pairs weak categories with their accuracy and honours the allowed list", () => {
  const stats: Stats = {
    totalAttempted: 20,
    totalCorrect: 10,
    accuracy: 0.5,
    byCategory: CATEGORY_IDS.map((category) => ({ category, attempted: 3, correct: 1, accuracy: 1 / 3 })),
    recentSessions: [],
    weakCategories: ["pharmacological_and_parenteral_therapies", "management_of_care"],
  };
  assert.deepEqual(weakAreasFrom(stats), [
    { category: "pharmacological_and_parenteral_therapies", accuracy: 1 / 3 },
    { category: "management_of_care", accuracy: 1 / 3 },
  ]);
  assert.deepEqual(weakAreasFrom(stats, ["management_of_care"]), [{ category: "management_of_care", accuracy: 1 / 3 }]);
  assert.deepEqual(weakAreasFrom(undefined), []);
});

test("prepareSources leaves small sources alone", () => {
  const sources = [
    { id: "1", name: "A", text: "x".repeat(100) },
    { id: "2", name: "B", text: "y".repeat(200) },
  ];
  const result = prepareSources(sources, 1000);
  assert.deepEqual(result.sources, sources);
  assert.deepEqual(result.warnings, []);
});

test("prepareSources trims only the longest sources down to a shared ceiling and warns", () => {
  const sources = [
    { id: "1", name: "Short notes", text: "s".repeat(100) },
    { id: "2", name: "Long book", text: "l".repeat(10_000) },
    { id: "3", name: "Longer book", text: "m".repeat(20_000) },
  ];
  const result = prepareSources(sources, 5_100);
  assert.equal(result.sources[0]!.text.length, 100);
  // 5100 - 100 = 5000 shared between the two long ones: 2500 each, plus a truncation marker.
  assert.ok(result.sources[1]!.text.startsWith("l".repeat(2500)));
  assert.ok(!result.sources[1]!.text.startsWith("l".repeat(2501)));
  assert.ok(result.sources[2]!.text.startsWith("m".repeat(2500)));
  assert.ok(result.sources[1]!.text.includes("truncated"));
  assert.equal(result.warnings.length, 1);
  assert.ok(result.warnings[0]!.includes("Long book"));
  assert.ok(result.warnings[0]!.includes("Longer book"));
  assert.ok(!result.warnings[0]!.includes("Short notes"));
});

test("buildUserMessage carries the plan, focus, weak areas, brief, sources and existing stems", () => {
  const counts = emptyCounts();
  counts.management_of_care = 2;
  counts.pharmacological_and_parenteral_therapies = 3;
  const text = buildUserMessage({
    request: {
      count: 5,
      categories: ["management_of_care", "pharmacological_and_parenteral_therapies"],
      difficulty: "hard",
      clinicalJudgmentSteps: ["take_action"],
      focus: "insulin peak times",
    },
    count: 5,
    counts,
    weakAreas: [{ category: "pharmacological_and_parenteral_therapies", accuracy: 0.5 }],
    researchBrief: "NCSBN emphasises medication safety (NCSBN test plan).",
    sources: [{ id: "s1", name: "Pharm <notes>", text: "Regular insulin peaks in 2 to 3 hours." }],
    existingStems: ["An old   stem about   delegation."],
  });
  assert.ok(text.startsWith("Write 5 NCLEX-RN practice questions."));
  assert.ok(text.includes("Management of Care [management_of_care]: 2"));
  assert.ok(text.includes("Pharmacological and Parenteral Therapies [pharmacological_and_parenteral_therapies]: 3"));
  assert.ok(text.includes("Difficulty: hard."));
  assert.ok(text.includes("take_action (Take Action)"));
  assert.ok(text.includes("Focus: insulin peak times."));
  assert.ok(text.includes("50% correct"));
  assert.ok(text.includes("<research_brief>\nNCSBN emphasises medication safety (NCSBN test plan).\n</research_brief>"));
  assert.ok(text.includes('<source name="Pharm  notes">\nRegular insulin peaks in 2 to 3 hours.\n</source>'));
  assert.ok(text.includes("- An old stem about delegation."));
  assert.ok(text.includes("cite the source name"));
  assert.ok(text.endsWith("Return exactly 5 questions as JSON matching the schema."));
});

test("buildUserMessage omits sections that have nothing to say", () => {
  const counts = emptyCounts();
  counts.basic_care_and_comfort = 1;
  const text = buildUserMessage({
    request: { count: 1 },
    count: 1,
    counts,
    weakAreas: [],
    sources: [],
    existingStems: [],
  });
  assert.ok(text.startsWith("Write 1 NCLEX-RN practice question."));
  assert.ok(text.includes("blueprint weighting"));
  assert.ok(!text.includes("<source"));
  assert.ok(!text.includes("<existing_stems>"));
  assert.ok(!text.includes("<research_brief>"));
  assert.ok(!text.includes("weakest categories"));
});

test("buildResearchUserMessage names the categories and focus", () => {
  const counts = emptyCounts();
  counts.safety_and_infection_control = 2;
  const text = buildResearchUserMessage({ request: { count: 2, focus: "isolation precautions" }, counts });
  assert.ok(text.includes("Safety and Infection Control"));
  assert.ok(text.includes("Focus topics: isolation precautions."));
  assert.ok(text.includes("NCSBN"));
  assert.ok(text.includes("pitfalls"));
});
