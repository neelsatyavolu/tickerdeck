import { expect, test } from "@playwright/test";
import path from "node:path";

// Imports a Yahoo Finance export into a new portfolio, checks the result,
// then deletes the portfolio. Same environment needs as flow.spec.ts.

test.skip(!process.env.E2E_BASE_URL && !process.env.NEON_AUTH_BASE_URL, "Set E2E_BASE_URL or the Neon env");

const fixture = path.join(__dirname, "fixtures", "yahoo-quotes.csv");

test("import a Yahoo Finance CSV into a new portfolio", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Create an account instead" }).click();
  await page.getByLabel("Email").fill(`e2e-import+${Date.now()}@tickerdeck.test`);
  await page.getByLabel("Password").fill(`e2e-${Math.random().toString(36).slice(2)}-pass`);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening)$/ })).toBeVisible({ timeout: 30_000 });

  await page.goto("/portfolios");
  await page.getByRole("button", { name: "Import CSV" }).first().click();
  await page.getByLabel("CSV file").setInputFiles(fixture);
  await expect(page.getByText(/6 lots across 5 symbols/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Yahoo Finance export/)).toBeVisible();
  await expect(page.getByText(/2 skipped/)).toBeVisible();
  await expect(page.getByLabel("New portfolio name")).toHaveValue("yahoo-quotes");
  await page.getByLabel("New portfolio name").fill("E2E Yahoo Import");
  await page.getByRole("button", { name: "Import 6 lots" }).click();

  await expect(page.getByRole("heading", { name: "E2E Yahoo Import" })).toBeVisible();
  for (const sym of ["AAPL", "BRK.B", "SPY", "VTSAX", "NVDA"]) {
    await expect(page.getByRole("row", { name: new RegExp(`^Show ${sym.replace(".", "\\.")} lots`) })).toBeVisible();
  }
  // Two AAPL lots merge into one 12.5-share position at a blended cost.
  await expect(page.getByRole("row", { name: /AAPL/ }).first()).toContainText("12.5");
  await expect(page.getByRole("row", { name: /AAPL/ }).first()).toContainText("$220.00");

  // Mutual funds get a daily price and a detail page.
  await page.getByRole("link", { name: "VTSAX", exact: true }).click();
  await expect(page.getByText(/Mutual fund/)).toBeVisible();
  await expect(page.getByRole("img", { name: /VTSAX price/ })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "E2E Yahoo Import" })).toBeVisible();

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).first().click();
  await expect(page.getByText("All portfolios")).toBeVisible();
});
