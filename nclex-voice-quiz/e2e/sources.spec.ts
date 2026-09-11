import { expect, test } from "@playwright/test";
import { trackPageErrors } from "./helpers/app.js";
import { installSpeechFakes } from "./helpers/speech-fakes.js";

const NOTES =
  "Regular insulin peaks two to four hours after a subcutaneous dose. NPH peaks four to twelve hours after the dose. " +
  "Lispro and aspart are rapid acting and peak within one to three hours.";

test.describe("sources", () => {
  test.beforeEach(async ({ page }) => {
    await installSpeechFakes(page);
  });

  test("adds pasted text, lists it with its size and deletes it", async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto("/#/sources");
    await expect(page.getByTestId("nav-sources")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("source-list")).toContainText("No study sources yet.");

    await page.getByTestId("source-name").fill("Insulin notes");
    await page.getByTestId("source-text").fill(NOTES);
    await page.getByTestId("source-add-text").click();

    await expect(page.getByTestId("source-status")).toContainText("Added “Insulin notes”");
    const item = page.getByTestId("source-list").locator("li", { hasText: "Insulin notes" });
    await expect(item).toHaveCount(1);
    await expect(item).toContainText(/Text · \d+ chars · added/);
    await expect(item).toContainText(`${NOTES.length} chars`);
    await expect(page.getByTestId("source-name")).toHaveValue("");
    await expect(page.getByTestId("source-text")).toHaveValue("");

    await item.getByRole("button", { name: "Preview" }).click();
    await expect(item.locator("pre")).toContainText("Lispro and aspart are rapid acting");

    page.once("dialog", (dialog) => dialog.accept());
    await item.locator('[data-testid^="source-delete-"]').click();
    await expect(page.getByTestId("source-status")).toContainText("Deleted “Insulin notes”");
    await expect(item).toHaveCount(0);
    await expect(page.getByTestId("source-list")).toContainText("No study sources yet.");
    errors.assertNone();
  });

  test("rejects an empty submission with a message", async ({ page }) => {
    await page.goto("/#/sources");
    await page.getByTestId("source-add-text").click();
    await expect(page.getByTestId("source-status")).toContainText("Both a name and some text are needed.");
  });
});
