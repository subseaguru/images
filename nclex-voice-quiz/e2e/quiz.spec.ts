import { expect, test, type Page } from "@playwright/test";
import { currentQuiz, stats, trackPageErrors, type BankQuestion } from "./helpers/app.js";
import { installSpeechFakes, recognitionStarts, removeSpeechApis, say, spoken } from "./helpers/speech-fakes.js";

async function startQuiz(page: Page, count: number, voice: boolean): Promise<void> {
  await page.goto("/");
  await page.getByTestId("quiz-count").fill(String(count));
  const toggle = page.getByTestId("quiz-voice-toggle");
  if (voice) await toggle.check();
  else await toggle.uncheck();
  await page.getByTestId("start-quiz").click();
  await expect(page.getByTestId("quiz-progress")).toHaveText(`1 / ${count}`);
}

function verdict(question: BankQuestion, chosen: "A" | "B" | "C"): "Correct" | "Wrong" {
  return question.correct === chosen ? "Correct" : "Wrong";
}

test.describe("quiz", () => {
  test("can be answered by voice, keyboard and click, then shows results and updates the stats", async ({ page, request }) => {
    const errors = trackPageErrors(page);
    const before = await stats(request);
    // "bravo" is queued before the quiz starts; the recogniser only runs once the question has
    // been read, so the fake hands it over at exactly the point a learner would speak.
    await installSpeechFakes(page, { transcripts: ["bravo"] });

    await startQuiz(page, 3, true);
    const quiz = await currentQuiz(page);
    expect(quiz.questions).toHaveLength(3);
    const [q1, q2, q3] = quiz.questions as [BankQuestion, BankQuestion, BankQuestion];
    await expect(page.getByTestId("question-stem")).toHaveText(q1.stem);
    await expect(page.getByTestId("option-B")).toContainText(q1.options[1]?.text ?? "");

    // Question 1: read aloud, answered by voice.
    await expect.poll(() => spoken(page).then((chunks) => chunks.join(" "))).toContain("Question 1 of 3");
    const banner = page.getByTestId("feedback-banner");
    await expect(banner).toBeVisible();
    const script = await spoken(page);
    const read = script.slice(0, 5).join(" ");
    expect(read).toContain("Question 1 of 3");
    expect(read).toContain(q1.stem);
    for (const option of q1.options) expect(read).toContain(`Option ${option.label}: ${option.text}`);

    const v1 = verdict(q1, "B");
    await expect(banner).toHaveText(new RegExp(`^${v1}`));
    await expect(page.getByTestId("option-B")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("feedback-rationale-B")).toHaveText(q1.options[1]?.rationale ?? "");
    await expect(page.getByTestId("next-question")).toBeVisible();
    await expect.poll(() => spoken(page).then((chunks) => chunks.length)).toBeGreaterThan(5);
    const feedback = (await spoken(page)).slice(5);
    expect(feedback[0]).toBe(`${v1}.`);
    if (v1 === "Wrong") {
      const correctText = q1.options.find((o) => o.label === q1.correct)?.text ?? "";
      expect(feedback.join(" ")).toContain(`The correct answer is ${q1.correct}, ${correctText.replace(/\.+$/, "")}`);
    } else {
      expect(feedback.join(" ")).not.toContain("The correct answer is");
    }

    // "next" by voice moves on.
    await say(page, "next");
    await expect(page.getByTestId("quiz-progress")).toHaveText("2 / 3");
    await expect(page.getByTestId("question-stem")).toHaveText(q2.stem);
    await expect(banner).toHaveCount(0);

    // Question 2: keyboard.
    await page.keyboard.press("c");
    await expect(banner).toHaveText(new RegExp(`^${verdict(q2, "C")}`));
    await expect(page.getByTestId("option-C")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("feedback-rationale-A")).toBeVisible();
    await page.getByTestId("next-question").click();
    await expect(page.getByTestId("quiz-progress")).toHaveText("3 / 3");
    await expect(page.getByTestId("question-stem")).toHaveText(q3.stem);

    // Question 3: tap.
    await page.getByTestId("option-A").click();
    await expect(banner).toHaveText(new RegExp(`^${verdict(q3, "A")}`));
    await expect(page.getByTestId("next-question")).toHaveText("See results");
    await page.getByTestId("next-question").click();

    // Results computed from the fixture keys.
    await expect(page).toHaveURL(/#\/results$/);
    const answers: [BankQuestion, "A" | "B" | "C"][] = [
      [q1, "B"],
      [q2, "C"],
      [q3, "A"],
    ];
    const correct = answers.filter(([q, chosen]) => q.correct === chosen).length;
    await expect(page.getByTestId("results-score")).toContainText(`${correct} / 3 correct`);
    const perCategory = new Map<string, { attempted: number; correct: number }>();
    for (const [q, chosen] of answers) {
      const row = perCategory.get(q.category) ?? { attempted: 0, correct: 0 };
      row.attempted += 1;
      if (q.correct === chosen) row.correct += 1;
      perCategory.set(q.category, row);
    }
    for (const [category, row] of perCategory) {
      await expect(page.getByTestId(`results-category-${category}`)).toContainText(`${row.correct} / ${row.attempted}`);
    }
    await expect(page.locator('[data-testid^="results-category-"]')).toHaveCount(perCategory.size);
    await expect(page.getByTestId("new-quiz")).toBeVisible();

    // The server recorded every attempt and the home snapshot reflects it.
    const after = await stats(request);
    expect(after.totalAttempted).toBe(before.totalAttempted + 3);
    expect(after.totalCorrect).toBe(before.totalCorrect + correct);
    await page.getByTestId("new-quiz").click();
    await expect(page.getByTestId("stats-attempted")).toContainText(String(after.totalAttempted));
    expect(await page.evaluate(() => sessionStorage.getItem("nclex.quiz"))).toBeNull();
    errors.assertNone();
  });

  test("falls back to the help text after three silent attempts", async ({ page }) => {
    await installSpeechFakes(page, { silenceMs: 50 });
    await startQuiz(page, 1, true);
    await expect(page.getByTestId("mic-status")).toHaveText("Tap an answer or say A, B or C.");
    expect(await recognitionStarts(page)).toBe(3);
    await page.getByTestId("option-A").click();
    await expect(page.getByTestId("feedback-banner")).toBeVisible();
  });

  test("works with buttons only when the browser has no speech APIs", async ({ page }) => {
    const errors = trackPageErrors(page);
    await removeSpeechApis(page);
    await page.goto("/");
    await expect(page.locator(".hint", { hasText: "no text-to-speech" })).toBeVisible();
    await startQuiz(page, 2, true);

    await expect(page.getByTestId("mic-status")).toContainText("Voice answers are not supported in this browser");
    await expect(page.getByTestId("mic-status")).toContainText("tapping or typing A, B or C");
    await expect(page.getByTestId("option-A")).toBeEnabled();
    await page.getByTestId("option-A").click();
    await expect(page.getByTestId("feedback-banner")).toHaveText(/^(Correct|Wrong)/);
    await expect(page.getByTestId("feedback-rationale-A")).toBeVisible();
    await expect(page.getByTestId("teaching-point")).toBeVisible();
    await page.getByTestId("next-question").click();
    await expect(page.getByTestId("quiz-progress")).toHaveText("2 / 2");
    await page.getByTestId("option-B").click();
    await expect(page.getByTestId("feedback-banner")).toHaveText(/^(Correct|Wrong)/);
    await page.getByTestId("next-question").click();
    await expect(page.getByTestId("results-score")).toContainText("/ 2 correct");
    errors.assertNone();
  });

  test("resumes at the same question after a reload", async ({ page }) => {
    await installSpeechFakes(page);
    await startQuiz(page, 3, false);
    await expect(page.getByTestId("mic-status")).toContainText("Voice is off for this quiz");
    // The bank is shuffled per quiz, so the score to expect depends on this question's own key.
    const first = (await currentQuiz(page)).questions[0] as BankQuestion;
    const scored = first.correct === "A" ? 1 : 0;
    await page.getByTestId("option-A").click();
    await expect(page.getByTestId("feedback-banner")).toBeVisible();
    await page.getByTestId("next-question").click();
    await expect(page.getByTestId("quiz-progress")).toHaveText("2 / 3");
    const stem = await page.getByTestId("question-stem").textContent();
    expect(stem).toBeTruthy();

    await page.reload();
    await expect(page.getByTestId("quiz-progress")).toHaveText("2 / 3");
    await expect(page.getByTestId("question-stem")).toHaveText(stem ?? "");
    await expect(page.getByTestId("option-A")).toBeEnabled();

    // Home offers to resume the same session.
    await page.getByTestId("nav-home").click();
    await expect(page.getByTestId("resume-quiz")).toBeVisible();
    await page.getByTestId("resume-quiz").click();
    await expect(page.getByTestId("quiz-progress")).toHaveText("2 / 3");
    await page.getByTestId("stop-quiz").click();
    await expect(page.getByTestId("results-score")).toContainText(`${scored} / 1 correct`);
  });
});
