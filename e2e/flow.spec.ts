import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

// Signs in a throwaway user through /auth/confirm with an admin-generated
// magic link, then walks the main flow. Needs NEXT_PUBLIC_SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY and FINNHUB_API_KEY in the environment.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

test.skip(!url || !serviceKey, "Supabase admin credentials not set");

const email = `e2e+${Date.now()}@tickerdeck.test`;

test.afterAll(async () => {
  const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const user = data?.users?.find((u) => u.email === email);
  if (user) await admin.auth.admin.deleteUser(user.id);
});

test("sign in, create a portfolio, add a holding, see a live price and forecast", async ({ page }) => {
  const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  expect(error).toBeNull();
  await page.goto(`/auth/confirm?token_hash=${data.properties!.hashed_token}&type=magiclink`);

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

  await page.getByRole("link", { name: "AAPL" }).click();
  await expect(page.getByRole("heading", { name: "AAPL" })).toBeVisible();
  await expect(page.getByText("Price targets")).toBeVisible();
});
