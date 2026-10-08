import { neon } from "@neondatabase/serverless";
import { expect, test } from "@playwright/test";

// Creates a throwaway account through the sign-up form, walks the main flow,
// and deletes the portfolio it made. Runs against a local dev server (needs
// the Neon + Finnhub env) or a deployment via E2E_BASE_URL. With DATABASE_URL
// set it also removes the throwaway account.

const dbUrl = process.env.DATABASE_URL;
test.skip(!process.env.E2E_BASE_URL && !process.env.NEON_AUTH_BASE_URL, "Set E2E_BASE_URL or the Neon env");

const email = `e2e+${Date.now()}@tickerdeck.test`;
const password = `e2e-${Math.random().toString(36).slice(2)}-pass`;

test.afterAll(async () => {
  if (!dbUrl) return;
  const sql = neon(dbUrl);
  await sql`delete from portfolios where name = 'E2E Core' and user_id in (select id::text from neon_auth."user" where email = ${email})`;
  await sql`delete from neon_auth."user" where email = ${email}`.catch(() => {});
});

test("sign up, create a portfolio, add a holding, see a live price and forecast", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole("button", { name: "Create an account instead" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByText("All portfolios")).toBeVisible();
  await page.getByRole("button", { name: "New portfolio" }).first().click();
  await page.getByLabel("Name").fill("E2E Core");
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page.getByRole("heading", { name: "E2E Core" })).toBeVisible();
  await page.getByRole("button", { name: "Add holding" }).click();
  await page.locator("#holding-symbol").fill("AAPL");
  await page.getByRole("option", { name: /AAPL/ }).first().click();
  await page.getByLabel("Shares").fill("3");
  await expect(page.getByLabel("Cost / share")).not.toHaveValue("");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  const row = page.getByRole("row", { name: /AAPL/ });
  await expect(row).toContainText("$");
  await expect(page.getByText(/Median in 3 months/)).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("img", { name: /Forecast range/ })).toBeVisible();

  await page.getByRole("link", { name: "AAPL", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AAPL", exact: true })).toBeVisible();
  await expect(page.getByText("Price targets")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Key statistics" })).toBeVisible();
  await expect(page.getByText("P/E (TTM)")).toBeVisible();
  await expect(page.getByRole("img", { name: /AAPL price/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Yahoo Finance/ }).first()).toHaveAttribute("href", "https://finance.yahoo.com/quote/AAPL/");

  // ETFs and share classes work too.
  for (const sym of ["SPY", "BRK.B"]) {
    await page.goto(`/s/${sym}`);
    await expect(page.getByRole("heading", { name: sym, exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: new RegExp(`${sym.replace(".", "\\.")} price`) })).toBeVisible();
  }
  await page.goto("/");
  await page.getByRole("link", { name: /E2E Core/ }).click();

  // Clean up through the app itself.
  await expect(page.getByRole("heading", { name: "E2E Core" })).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).first().click();
  await expect(page.getByText("All portfolios")).toBeVisible();
});
