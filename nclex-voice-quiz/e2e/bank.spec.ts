import { expect, test } from "@playwright/test";
import { bank, trackPageErrors } from "./helpers/app.js";
import { installSpeechFakes } from "./helpers/speech-fakes.js";

const IMPORT_STEM = "A client taking warfarin reports dark tarry stools and dizziness. Which laboratory result should the nurse check first?";

const VALID_QUESTION = {
  stem: IMPORT_STEM,
  options: [
    { label: "A", text: "International normalized ratio.", rationale: "Correct. Melena and dizziness suggest bleeding from over-anticoagulation; the INR shows whether warfarin is supratherapeutic." },
    { label: "B", text: "Serum potassium.", rationale: "Potassium is not affected by warfarin and does not explain the bleeding." },
    { label: "C", text: "Blood glucose.", rationale: "Dizziness alone might prompt a glucose check, but tarry stools point to bleeding first." },
  ],
  correct: "A",
  category: "pharmacological_and_parenteral_therapies",
  subtopic: "Adverse Effects/Contraindications/Side Effects/Interactions",
  difficulty: "medium",
  teachingPoint: "Bleeding on warfarin: check the INR first, then hold the drug and notify the provider.",
};

// Missing rationales and an unknown category: importable, but flagged for review.
const INCOMPLETE_STEM = "A nurse reviews the plan of care for a client who is one day after abdominal surgery and reports gas pain.";
const INCOMPLETE_QUESTION = {
  stem: INCOMPLETE_STEM,
  options: [
    { label: "A", text: "Encourage early ambulation in the hallway." },
    { label: "B", text: "Keep the client on strict bed rest." },
    { label: "C", text: "Offer a carbonated drink with the meal." },
  ],
  correct: "A",
  category: "not_a_category",
  difficulty: "medium",
};

// No stem and only one option: nothing to recover, so this one is rejected.
const BROKEN_QUESTION = { options: ["only one option"], answer: "A" };

// The shape ChatGPT produces when it is not given a strict schema.
const CHATGPT_STEM = "A nurse is teaching a client who takes lithium about signs of toxicity. Which statement by the client indicates understanding of the teaching?";
const CHATGPT_QUESTION = {
  question: `**${CHATGPT_STEM}**`,
  options: [
    "I will call the clinic if I have vomiting, diarrhea and muscle tremors.",
    "I will stop drinking water so the level stays steady.",
    "I will double the dose if I feel unwell.",
  ],
  answer: "A",
  explanation: "Lithium toxicity shows up as gastrointestinal upset and tremor.",
};

test.describe("bank", () => {
  test.beforeEach(async ({ page }) => {
    await installSpeechFakes(page);
  });

  test("lists the bank with counts, filters by search and expands rationales", async ({ page, request }) => {
    const errors = trackPageErrors(page);
    const { questions, counts } = await bank(request);
    expect(counts.bySource.bundled).toBe(24);

    await page.goto("/#/bank");
    await expect(page.getByTestId("bank-summary")).toContainText(`${counts.total} shown of ${counts.total} in the bank (${counts.bySource.bundled} bundled`);
    const cards = page.getByTestId("bank-list").locator('[data-testid^="bank-question-"]');
    await expect(cards).toHaveCount(Math.min(counts.total, 50));
    await expect(page.getByTestId("bank-question-moc-901")).toBeVisible();
    await expect(page.getByTestId("bank-question-moc-901").locator('[data-testid^="bank-delete-"]')).toHaveCount(0);

    const needle = "delegate";
    const matching = questions.filter((q) => [q.stem, ...q.options.map((o) => o.text)].some((t) => t.toLowerCase().includes(needle)));
    expect(matching.length).toBeGreaterThan(0);
    expect(matching.length).toBeLessThan(questions.length);
    await page.getByTestId("bank-search").fill(needle);
    await expect(cards).toHaveCount(matching.length);
    for (const q of matching) await expect(page.getByTestId(`bank-question-${q.id}`)).toBeVisible();
    await expect(page.getByTestId("bank-summary")).toContainText(`${matching.length} shown of ${counts.total}`);

    await page.getByTestId("bank-search").fill("zzzz-no-such-question");
    await expect(page.getByTestId("bank-list")).toContainText("No questions match.");
    await page.getByTestId("bank-search").fill("");
    await expect(cards).toHaveCount(Math.min(counts.total, 50));

    await page.getByTestId("bank-category").selectOption("management_of_care");
    await expect(cards).toHaveCount(counts.byCategory["management_of_care"] ?? 0);
    await page.getByTestId("bank-category").selectOption("");

    const moc = questions.find((q) => q.id === "moc-901");
    expect(moc).toBeDefined();
    const card = page.getByTestId("bank-question-moc-901");
    await expect(card).not.toHaveAttribute("open", "");
    await card.locator("summary").click();
    await expect(card).toHaveAttribute("open", "");
    for (const option of moc?.options ?? []) {
      await expect(card).toContainText(option.rationale);
    }
    await expect(card).toContainText(`${moc?.correct}. `);
    await expect(card).toContainText("(correct)");
    errors.assertNone();
  });

  test("imports a JSON file, reports rejections and lists the new question", async ({ page, request }) => {
    const errors = trackPageErrors(page);
    const before = await bank(request);
    await page.goto("/#/bank");
    await expect(page.getByTestId("bank-summary")).toContainText("shown of");

    await page.getByTestId("bank-import-file").setInputFiles({
      name: "my-questions.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ version: 1, questions: [VALID_QUESTION, INCOMPLETE_QUESTION, BROKEN_QUESTION] }, null, 2)),
    });

    const status = page.getByTestId("bank-status");
    await expect(status).toContainText("Imported 2 questions.");
    await expect(status).toContainText("1 need review");
    await expect(status).toContainText("Question 3 rejected:");

    await expect(page.getByTestId("bank-summary")).toContainText(`${before.counts.total + 2} in the bank`);
    await expect(page.getByTestId("bank-summary")).toContainText(`${before.counts.bySource.imported + 2} imported`);
    await page.getByTestId("bank-search").fill("warfarin reports dark tarry");
    const card = page.getByTestId("bank-list").locator('[data-testid^="bank-question-"]');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(IMPORT_STEM);
    await expect(card).toContainText("Imported");
    await card.locator("summary").click();
    await expect(card).toContainText(VALID_QUESTION.options[0]?.rationale ?? "");

    const after = await bank(request);
    const imported = after.questions.find((q) => q.stem === IMPORT_STEM);
    expect(imported?.source).toBe("imported");

    // The incomplete question is flagged, filterable and offers enrichment.
    await page.getByTestId("bank-search").fill("");
    await page.getByTestId("bank-needs-review").check();
    const flagged = page.getByTestId("bank-list").locator('[data-testid^="bank-question-"]');
    await expect(flagged).toHaveCount(1);
    await expect(flagged).toContainText(INCOMPLETE_STEM);
    await expect(flagged.locator('[data-testid^="bank-flag-"]')).toBeVisible();
    await expect(page.getByTestId("bank-enrich-all")).toContainText("Enrich 1 question with Claude");
    // The per-question button lives inside the collapsed card.
    await flagged.locator("summary").click();
    await expect(flagged.locator('[data-testid^="bank-enrich-"]')).toBeVisible();
    await page.getByTestId("bank-needs-review").uncheck();

    // Imported questions can be deleted from the bank page.
    await page.getByTestId("bank-search").fill("warfarin reports dark tarry");
    await expect(card).toHaveCount(1);
    // Re-rendered by the search, so the card is collapsed again and its buttons are hidden.
    await card.locator("summary").click();
    page.once("dialog", (dialog) => dialog.accept());
    await card.locator('[data-testid^="bank-delete-"]').click();
    await expect(status).toHaveText("Question deleted.");
    await expect(page.getByTestId("bank-list")).toContainText("No questions match.");
    expect((await bank(request)).counts.total).toBe(before.counts.total + 1);
    errors.assertNone();
  });

  test("imports a question set written by another tool and flags what it had to guess", async ({ page, request }) => {
    const errors = trackPageErrors(page);
    const before = await bank(request);
    await page.goto("/#/bank");

    // A bare array, options as plain strings, "answer" and "explanation" instead of the app's own
    // field names, and markdown around the stem: all repaired by the server.
    await page.getByTestId("bank-import-file").setInputFiles({
      name: "from-chatgpt.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify([CHATGPT_QUESTION], null, 2)),
    });

    const status = page.getByTestId("bank-status");
    await expect(status).toContainText("Imported 1 question.");
    await expect(status).toContainText("1 need review");

    // Earlier specs leave their own flagged questions in the shared bank, so narrow to this one.
    await page.getByTestId("bank-needs-review").check();
    await page.getByTestId("bank-search").fill("lithium");
    const card = page.getByTestId("bank-list").locator('[data-testid^="bank-question-"]');
    await expect(card).toHaveCount(1);
    // The markdown is gone and the stem reads as plain text.
    await expect(card).toContainText(CHATGPT_STEM);
    await expect(card).not.toContainText("**");
    await card.locator("summary").click();
    await expect(card).toContainText("Rationale not provided yet.");

    const after = await bank(request);
    const imported = after.questions.find((q) => q.stem === CHATGPT_STEM);
    expect(imported?.source).toBe("imported");
    expect(imported?.correct).toBe("A");
    expect(imported?.options).toHaveLength(3);
    expect(after.counts.total).toBe(before.counts.total + 1);
    errors.assertNone();
  });
});
