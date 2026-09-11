import { expect, test } from "@playwright/test";
import { removeApiKey, trackPageErrors } from "./helpers/app.js";
import { installSpeechFakes } from "./helpers/speech-fakes.js";

const FAKE_KEY = "sk-ant-api03-e2e-fake-key-000000000000000000000000000000000000000000000000000000000000000000";

test.describe("settings", () => {
  test.beforeEach(async ({ page }) => {
    await installSpeechFakes(page);
  });

  test.afterEach(async ({ request }) => {
    await removeApiKey(request);
    await request.put("/api/settings", { data: { model: "claude-opus-5", defaultCount: 10 } });
  });

  test("saves and removes the API key with a masked hint", async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto("/#/settings");
    await expect(page.getByTestId("settings-key-info")).toHaveText("No key saved.");
    await expect(page.getByTestId("settings-remove-key")).toBeDisabled();
    await expect(page.getByTestId("settings-verify-key")).toBeDisabled();

    await page.getByTestId("settings-api-key").fill(FAKE_KEY);
    await page.getByTestId("settings-save-key").click();
    await expect(page.getByTestId("settings-status")).toHaveText("API key saved.");
    await expect(page.getByTestId("settings-key-info")).toContainText("sk-ant-…0000");
    await expect(page.getByTestId("settings-key-info")).not.toContainText("fake-key");
    await expect(page.getByTestId("settings-api-key")).toHaveValue("");
    await expect(page.getByTestId("settings-remove-key")).toBeEnabled();
    await expect(page.getByTestId("settings-verify-key")).toBeEnabled();

    await page.getByTestId("settings-remove-key").click();
    await expect(page.getByTestId("settings-status")).toHaveText("API key removed.");
    await expect(page.getByTestId("settings-key-info")).toHaveText("No key saved.");
    await expect(page.getByTestId("settings-remove-key")).toBeDisabled();
    errors.assertNone();
  });

  test("persists the model and default count across a reload", async ({ page }) => {
    await page.goto("/#/settings");
    await expect(page.getByTestId("settings-model")).toHaveValue("claude-opus-5");
    await expect(page.getByTestId("settings-default-count")).toHaveValue("10");

    await page.getByTestId("settings-model").fill("claude-sonnet-4-5");
    await page.getByTestId("settings-default-count").fill("7");
    await page.getByTestId("settings-save").click();
    await expect(page.getByTestId("settings-status")).toHaveText("Settings saved.");

    await page.reload();
    await expect(page.getByTestId("settings-model")).toHaveValue("claude-sonnet-4-5");
    await expect(page.getByTestId("settings-default-count")).toHaveValue("7");

    // The home form picks up the new default.
    await page.getByTestId("nav-home").click();
    await expect(page.getByTestId("quiz-count")).toHaveValue("7");
  });
});
