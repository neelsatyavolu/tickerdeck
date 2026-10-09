import { expect, test } from "@playwright/test";

// The "Following Stocks Online" worksheet, done in tickerdeck: index levels and
// 10-year performance, and a look-up table for nine companies.

test.skip(!process.env.E2E_BASE_URL && !process.env.NEON_AUTH_BASE_URL, "Set E2E_BASE_URL or the Neon env");

const TICKERS = ["NKE", "META", "AAPL", "TSLA", "COST", "EBAY", "KO", "SBUX", "BRK.A"];

test("everything the worksheet asks for is on screen", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  await page.getByRole("button", { name: "Create an account instead" }).click();
  await page.getByLabel("Email").fill(`e2e-sheet+${Date.now()}@tickerdeck.test`);
  await page.getByLabel("Password").fill(`e2e-${Math.random().toString(36).slice(2)}-pass`);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening)$/ })).toBeVisible({ timeout: 30_000 });

  // Search is instant once the index is loaded (it warms in the background).
  const search = page.getByRole("combobox").first();
  await search.click();
  await page.waitForTimeout(2500);
  await search.fill("");
  const t0 = Date.now();
  await search.pressSequentially("nike");
  await expect(page.getByRole("option", { name: /^NKE/ })).toBeVisible();
  expect(Date.now() - t0).toBeLessThan(1000);
  await search.fill("");

  // Q1–2: Dow and Nasdaq level, today's move, 10-year performance.
  for (const sym of ["^DJI", "^IXIC"]) {
    await page.goto(`/s/${encodeURIComponent(sym)}`);
    await expect(page.getByRole("heading", { name: sym, exact: true })).toBeVisible({ timeout: 30_000 });
    const perf = page.getByRole("list", { name: "Price performance" });
    await expect(perf.getByRole("listitem").filter({ hasText: "10Y" })).toContainText(/[+−]\d/);
  }

  // Q3–4: a list of the worksheet's companies, in the Fundamentals view.
  const listId = await page.evaluate(async () => (await (await fetch("/api/watchlists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Worksheet" }) })).json()).data.id);
  for (const s of TICKERS) {
    await page.evaluate(([sym, l]) => fetch("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: sym, watchlistId: l }) }), [s, listId]);
  }
  await page.goto(`/watchlist?list=${listId}`);
  await page.getByRole("button", { name: "Fundamentals" }).click();
  for (const s of TICKERS) {
    const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: s, exact: true }) });
    await expect(row).toContainText(/NASDAQ|NYSE/, { timeout: 30_000 });
    await expect(row).toContainText(/\$[\d,]+\.\d{2} – \$[\d,]+\.\d{2}/); // 52-week range
    await expect(row).toContainText(/\d[\d.]*[KMB]? \/ \d/); // volume / average volume
  }
  await expect(page.getByRole("row").filter({ hasText: "BRK.A" })).toContainText("NYSE");
  await expect(page.getByRole("row").filter({ hasText: "KO" }).first()).toContainText(/\$\d+\.\d{2} \/ \d/); // Coca-Cola pays a dividend
});
