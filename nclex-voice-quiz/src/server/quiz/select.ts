/**
 * Quiz question selection (docs/API.md, "POST /api/quiz/start").
 *
 * Pure: the only source of randomness is the injected `random` function, so tests can drive the
 * algorithm deterministically.
 */
import type { CategoryId, Question, QuizStartRequest, Stats } from "../../shared/types.js";
import { CATEGORY_IDS } from "../../shared/types.js";
import { blueprintDistribution } from "../../shared/blueprint.js";

export const MIN_COUNT = 1;
export const MAX_COUNT = 50;
/** Share of the quota that adaptive mode may move toward weak categories. */
export const ADAPTIVE_SHIFT = 0.4;

export type RandomFn = () => number;

export function clampCount(count: number): number {
  if (!Number.isFinite(count)) return MIN_COUNT;
  return Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.floor(count)));
}

function shuffle<T>(items: readonly T[], random: RandomFn): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

export function filterBank(bank: readonly Question[], request: QuizStartRequest): Question[] {
  const categories = request.categories && request.categories.length > 0 ? new Set(request.categories) : null;
  const sources = request.sources && request.sources.length > 0 ? new Set(request.sources) : null;
  const difficulty = request.difficulty && request.difficulty.length > 0 ? new Set(request.difficulty) : null;
  return bank.filter(
    (q) =>
      (!categories || categories.has(q.category)) &&
      (!sources || sources.has(q.source)) &&
      (!difficulty || difficulty.has(q.difficulty)),
  );
}

/**
 * Moves up to `ADAPTIVE_SHIFT` of the total quota from strong categories to weak ones. Strong
 * categories keep at least one question; weak categories receive the moved questions round-robin,
 * worst first.
 */
export function applyAdaptiveShift(
  quota: Record<CategoryId, number>,
  weakCategories: readonly CategoryId[],
): Record<CategoryId, number> {
  const result = { ...quota };
  const total = CATEGORY_IDS.reduce((sum, id) => sum + result[id], 0);
  const allowed = CATEGORY_IDS.filter((id) => result[id] > 0);
  const weak = weakCategories.filter((id) => allowed.includes(id));
  const strong = allowed.filter((id) => !weak.includes(id));
  if (weak.length === 0 || strong.length === 0) return result;

  let budget = Math.floor(total * ADAPTIVE_SHIFT);
  let target = 0;
  while (budget > 0) {
    // Take from whichever strong category currently has the most, so the remainder stays balanced.
    const donor = strong.filter((id) => result[id] > 1).sort((a, b) => result[b] - result[a])[0];
    if (!donor) break;
    result[donor] -= 1;
    const receiver = weak[target % weak.length] as CategoryId;
    result[receiver] += 1;
    target += 1;
    budget -= 1;
  }
  return result;
}

/** Orders candidates: not-recently-answered first, random within each group. */
function prioritize(candidates: readonly Question[], recent: ReadonlySet<string>, avoidRecent: boolean, random: RandomFn): Question[] {
  const shuffled = shuffle(candidates, random);
  if (!avoidRecent) return shuffled;
  return [...shuffled.filter((q) => !recent.has(q.id)), ...shuffled.filter((q) => recent.has(q.id))];
}

/** Round-robin across categories (largest group first) so play order never groups a category. */
function interleave(picked: readonly Question[], random: RandomFn): Question[] {
  const groups = new Map<CategoryId, Question[]>();
  for (const q of shuffle(picked, random)) {
    const group = groups.get(q.category);
    if (group) group.push(q);
    else groups.set(q.category, [q]);
  }
  const order = shuffle([...groups.values()], random).sort((a, b) => b.length - a.length);
  const out: Question[] = [];
  let index = 0;
  while (out.length < picked.length) {
    for (const group of order) {
      const q = group[index];
      if (q) out.push(q);
    }
    index += 1;
  }
  return out;
}

export function selectQuestions(
  bank: readonly Question[],
  request: QuizStartRequest,
  stats: Stats | undefined,
  recentlyAnsweredIds: ReadonlySet<string>,
  random: RandomFn = Math.random,
): Question[] {
  const count = clampCount(request.count);
  const pool = filterBank(bank, request);
  if (pool.length === 0) return [];
  const avoidRecent = request.avoidRecent !== false;

  let quota = blueprintDistribution(count, request.categories);
  if (request.adaptive !== false && stats && stats.weakCategories.length > 0) {
    quota = applyAdaptiveShift(quota, stats.weakCategories);
  }

  const byCategory = new Map<CategoryId, Question[]>();
  for (const q of pool) {
    const list = byCategory.get(q.category);
    if (list) list.push(q);
    else byCategory.set(q.category, [q]);
  }

  const picked: Question[] = [];
  const pickedIds = new Set<string>();
  for (const id of CATEGORY_IDS) {
    const wanted = quota[id];
    if (wanted <= 0) continue;
    const candidates = byCategory.get(id) ?? [];
    for (const q of prioritize(candidates, recentlyAnsweredIds, avoidRecent, random).slice(0, wanted)) {
      picked.push(q);
      pickedIds.add(q.id);
    }
  }

  const shortfall = count - picked.length;
  if (shortfall > 0) {
    const leftovers = pool.filter((q) => !pickedIds.has(q.id));
    for (const q of prioritize(leftovers, recentlyAnsweredIds, avoidRecent, random).slice(0, shortfall)) {
      picked.push(q);
      pickedIds.add(q.id);
    }
  }

  return interleave(picked, random);
}
