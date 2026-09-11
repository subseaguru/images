/**
 * Small helpers shared by the specs: typed API access for setup/verification and page-error
 * tracking so a JavaScript error in the app fails the test that caused it.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

export interface BankCounts {
  total: number;
  bySource: { bundled: number; ai: number; imported: number };
  byCategory: Record<string, number>;
}

export interface BankQuestion {
  id: string;
  stem: string;
  category: string;
  correct: "A" | "B" | "C";
  options: { label: "A" | "B" | "C"; text: string; rationale: string }[];
  source: string;
}

export async function bank(request: APIRequestContext): Promise<{ questions: BankQuestion[]; counts: BankCounts }> {
  const response = await request.get("/api/questions");
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { questions: BankQuestion[]; counts: BankCounts };
}

export async function stats(request: APIRequestContext): Promise<{ totalAttempted: number; totalCorrect: number }> {
  const response = await request.get("/api/stats");
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { totalAttempted: number; totalCorrect: number };
}

export async function saveApiKey(request: APIRequestContext, apiKey: string): Promise<void> {
  const response = await request.put("/api/settings/api-key", { data: { apiKey } });
  expect(response.ok()).toBeTruthy();
}

export async function removeApiKey(request: APIRequestContext): Promise<void> {
  const response = await request.delete("/api/settings/api-key");
  expect(response.ok()).toBeTruthy();
}

/**
 * Collect uncaught errors; call `assertNone()` at the end of the test.
 *
 * Chrome logs "Failed to load resource: ..." for every non-2xx response, including the ones the
 * app deliberately provokes and handles (a rejected API key, for example). Those are network
 * status lines, not defects, so they are filtered out; the specs assert the app's own handling of
 * such responses separately.
 */
export function trackPageErrors(page: Page): { assertNone: () => void } {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.startsWith("Failed to load resource")) return;
    errors.push(text);
  });
  return {
    assertNone: () => expect(errors, "unexpected browser errors").toEqual([]),
  };
}

/** The quiz session the app keeps in sessionStorage (exposed through window.__nclex). */
export interface QuizSessionLike {
  sessionId: string;
  index: number;
  questions: BankQuestion[];
  answers: { questionId: string; chosen: string; correct: string; isCorrect: boolean }[];
}

export async function currentQuiz(page: Page): Promise<QuizSessionLike> {
  const session = await page.evaluate(() => {
    const hooks = (window as unknown as { __nclex?: { state: { getQuiz(): unknown } } }).__nclex;
    return hooks ? hooks.state.getQuiz() : null;
  });
  expect(session, "a quiz should be in progress").not.toBeNull();
  return session as QuizSessionLike;
}
