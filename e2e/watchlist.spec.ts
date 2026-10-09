import { expect, test } from "@playwright/test";

// Watch symbols from the watchlist page and from a stock page, then remove one.

test.skip(!process.env.E2E_BASE_URL && !process.env.NEON_AUTH_BASE_URL, "Set E2E_BASE_URL or the Neon env");

test("watch symbols without holding them", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Create an account instead" }).click();
  await page.getByLabel("Email").fill(`e2e-watch+${Date.now()}@tickerdeck.test`);
  await page.getByLabel("Password").fill(`e2e-${Math.random().toString(36).slice(2)}-pass`);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("All portfolios")).toBeVisible();

  await page.getByRole("link", { name: "Watchlist" }).click();
  await expect(page.getByRole("heading", { name: "Watchlist" })).toBeVisible();
  const add = page.getByPlaceholder("Add a ticker or company");
  for (const sym of ["AAPL", "VTSAX"]) {
    await add.fill(sym);
    await page.getByRole("option", { name: new RegExp(`^${sym}\\b`) }).first().click();
    await expect(page.getByRole("row", { name: new RegExp(`^${sym}`) })).toBeVisible();
  }
  await expect(page.getByRole("img", { name: /AAPL over 3 months/ })).toBeVisible({ timeout: 30_000 });

  // Watch from a stock page.
  await page.goto("/s/NVDA");
  await page.getByRole("button", { name: "Watch", exact: true }).click();
  await expect(page.getByRole("button", { name: /Watching/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("link", { name: "Watchlist" }).click();
  await expect(page.getByRole("row", { name: /^NVDA/ })).toBeVisible();
  await expect(page.getByText("3 symbols")).toBeVisible();

  // Market indexes: one click to watch, priced via CNBC, with their own page.
  await page.getByRole("button", { name: "+ S&P 500" }).click();
  const spx = page.getByRole("row", { name: /^\^GSPC/ });
  await expect(spx).toBeVisible();
  await expect(spx).toContainText("$");
  await page.getByRole("link", { name: "^GSPC", exact: true }).click();
  await expect(page.getByRole("heading", { name: "^GSPC", exact: true })).toBeVisible();
  await expect(page.getByText(/Market index/)).toBeVisible();
  await expect(page.getByRole("img", { name: /\^GSPC price/ })).toBeVisible();
  await page.getByRole("link", { name: "Watchlist" }).click();

  await page.getByRole("button", { name: "Stop watching AAPL" }).click();
  await expect(page.getByRole("row", { name: /^AAPL/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("3 symbols")).toBeVisible();

  // Reorder with the buttons, then by dragging; the order survives a reload.
  const order = async () => (await page.locator("tbody tr").allInnerTexts()).map((t) => t.trim().split(/\s+/)[0]);
  expect(await order()).toEqual(["VTSAX", "NVDA", "^GSPC"]);
  await page.getByRole("button", { name: "Move ^GSPC up" }).click();
  await page.getByRole("button", { name: "Move ^GSPC up" }).click();
  await expect.poll(order).toEqual(["^GSPC", "VTSAX", "NVDA"]);
  await page.locator("tbody tr", { hasText: "NVDA" }).dragTo(page.locator("tbody tr", { hasText: "^GSPC" }), { targetPosition: { x: 20, y: 2 } });
  await expect.poll(order).toEqual(["NVDA", "^GSPC", "VTSAX"]);
  await page.reload();
  await expect(page.getByText("3 symbols")).toBeVisible();
  await expect.poll(order).toEqual(["NVDA", "^GSPC", "VTSAX"]);

  // The assistant opens as a sheet from the bottom and closes with Escape.
  await page.getByRole("button", { name: /^Ask AI/ }).click();
  const sheet = page.getByRole("dialog", { name: "AI assistant" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText(/Connect your ChatGPT or Grok/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});
