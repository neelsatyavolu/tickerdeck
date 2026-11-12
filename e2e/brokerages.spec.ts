import { expect, test } from "@playwright/test";

// Brokerage linking is for the deployment's owner only. A freshly created
// account must not see the section or reach its routes. Same environment
// needs as flow.spec.ts.

test.skip(!process.env.E2E_BASE_URL && !process.env.NEON_AUTH_BASE_URL, "Set E2E_BASE_URL or the Neon env");

test("a new account can't see or use brokerage linking", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Create an account instead" }).click();
  await page.getByLabel("Email").fill(`e2e-brokerages+${Date.now()}@tickerdeck.test`);
  await page.getByLabel("Password").fill(`e2e-${Math.random().toString(36).slice(2)}-pass`);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening)$/ })).toBeVisible({ timeout: 30_000 });

  const status = await page.request.get("/api/plaid/items");
  expect(await status.json()).toEqual({ ok: true, data: { enabled: false, items: [] } });

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
  await expect(page.getByText(/^User id/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Brokerages" })).toHaveCount(0);

  const origin = new URL(page.url()).origin;
  const post = (path: string, data: object) => page.request.post(path, { data, headers: { origin } });
  expect((await post("/api/plaid/link-token", {})).status()).toBe(404);
  expect((await post("/api/plaid/exchange", { publicToken: "public-x", institutionId: "ins_1", institutionName: "Schwab" })).status()).toBe(404);
  expect((await post("/api/plaid/items/00000000-0000-4000-8000-000000000000/sync", {})).status()).toBe(404);
  expect((await page.request.delete("/api/plaid/items/00000000-0000-4000-8000-000000000000", { headers: { origin } })).status()).toBe(404);
});
