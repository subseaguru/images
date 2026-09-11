import { expect, test } from "@playwright/test";
import { bank, trackPageErrors } from "./helpers/app.js";
import { installSpeechFakes } from "./helpers/speech-fakes.js";

const CATEGORIES: { id: string; name: string; range: string }[] = [
  { id: "management_of_care", name: "Management of Care", range: "15–21%" },
  { id: "safety_and_infection_control", name: "Safety and Infection Control", range: "10–16%" },
  { id: "health_promotion_and_maintenance", name: "Health Promotion and Maintenance", range: "6–12%" },
  { id: "psychosocial_integrity", name: "Psychosocial Integrity", range: "6–12%" },
  { id: "basic_care_and_comfort", name: "Basic Care and Comfort", range: "6–12%" },
  { id: "pharmacological_and_parenteral_therapies", name: "Pharmacological and Parenteral Therapies", range: "13–19%" },
  { id: "reduction_of_risk_potential", name: "Reduction of Risk Potential", range: "9–15%" },
  { id: "physiological_adaptation", name: "Physiological Adaptation", range: "11–17%" },
];

test.describe("home", () => {
  test.beforeEach(async ({ page }) => {
    await installSpeechFakes(page);
  });

  test("shows the blueprint categories, the bank size and an enabled start button", async ({ page, request }) => {
    const errors = trackPageErrors(page);
    const { counts } = await bank(request);

    await page.goto("/");
    await expect(page.getByTestId("nav-home")).toHaveAttribute("aria-current", "page");

    for (const category of CATEGORIES) {
      const box = page.getByTestId(`quiz-category-${category.id}`);
      await expect(box).toBeChecked();
      const label = box.locator("xpath=ancestor::label[1]");
      await expect(label).toContainText(category.name);
      await expect(label).toContainText(category.range);
    }

    await expect(page.getByTestId("stats-bank-size")).toContainText(String(counts.total));
    await expect(page.getByTestId("stats-attempted")).toBeVisible();
    await expect(page.getByTestId("stats-accuracy")).toBeVisible();

    const count = page.getByTestId("quiz-count");
    await expect(count).toHaveValue(/^\d+$/);
    await expect(page.getByTestId("quiz-voice-toggle")).toBeVisible();
    await expect(page.getByTestId("start-quiz")).toBeEnabled();
    errors.assertNone();
  });

  test("refuses to start without a category", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "None", exact: true }).click();
    await page.getByTestId("start-quiz").click();
    await expect(page.getByTestId("home-status")).toContainText("Pick at least one category.");
    await expect(page).toHaveURL(/#\/$|\/$/);
  });
});
