import { expect, test } from "@playwright/test";
import { removeApiKey, saveApiKey, trackPageErrors } from "./helpers/app.js";
import { installSpeechFakes } from "./helpers/speech-fakes.js";

test.describe("generate", () => {
  test.beforeEach(async ({ page }) => {
    await installSpeechFakes(page);
  });

  test.afterEach(async ({ request }) => {
    await removeApiKey(request);
  });

  test("points to Settings when no API key is configured", async ({ page, request }) => {
    await removeApiKey(request);
    await page.goto("/#/generate");
    await expect(page.getByTestId("generate-no-key")).toBeVisible();
    await expect(page.getByTestId("generate-no-key").getByRole("link", { name: "Settings" })).toHaveAttribute("href", "#/settings");
    await expect(page.getByTestId("generate-submit")).toHaveCount(0);
    await expect(page.getByTestId("generate-count")).toHaveValue("5");
  });

  test("shows the generating state and then the server's error", async ({ page, request }) => {
    const errors = trackPageErrors(page);
    await saveApiKey(request, "sk-ant-api03-not-a-real-key-for-e2e-0000000000000000000000000000000000000000000000000000");
    await page.goto("/#/generate");
    const submit = page.getByTestId("generate-submit");
    await expect(submit).toBeVisible();
    await expect(page.getByTestId("generate-no-key")).toHaveCount(0);

    // Hold the request until the in-progress state has been observed, then let the real server
    // answer (an invalid key or no network - either way an error the learner can read).
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/generate", async (route) => {
      await held;
      await route.continue();
    });

    await page.getByTestId("generate-count").fill("1");
    await submit.click();
    const status = page.getByTestId("generate-status");
    await expect(status).toContainText("Generating 1 question");
    await expect(status).toContainText("elapsed");
    await expect(submit).toBeDisabled();
    release();

    await expect(status).toHaveClass(/error/, { timeout: 60_000 });
    await expect(status).not.toHaveText("");
    await expect(status).not.toContainText("Generating");
    await expect(submit).toBeEnabled();
    await expect(page.getByTestId("generate-result")).toBeEmpty();
    errors.assertNone();
  });
});
