import { expect, test } from "@playwright/test";

// The news tab: curated headlines with images, stories for watched symbols,
// and the footer's link to the source code.

test.skip(!process.env.E2E_BASE_URL && !process.env.NEON_AUTH_BASE_URL, "Set E2E_BASE_URL or the Neon env");

test("news tab shows curated stories and the footer links to GitHub", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  await page.getByRole("button", { name: "Create an account instead" }).click();
  await page.getByLabel("Email").fill(`e2e-news+${Date.now()}@tickerdeck.test`);
  await page.getByLabel("Password").fill(`e2e-${Math.random().toString(36).slice(2)}-pass`);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening)$/ })).toBeVisible({ timeout: 30_000 });

  // Watch a stock so "Your stocks" has something to show.
  await page.goto("/s/AAPL");
  await page.getByRole("button", { name: "Watch", exact: true }).click();
  await expect(page.getByRole("button", { name: "Watching", exact: true })).toBeVisible();

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "News" }).click();
  await expect(page.getByRole("heading", { name: "News", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".news-lead")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Top stories" })).toBeVisible();
  await expect(page.locator(".news-card").first()).toBeVisible();
  await page.screenshot({ path: "test-results/news.png" });

  // Section tabs and the source filter narrow the list.
  await page.getByRole("button", { name: "Markets" }).click();
  await expect(page.locator(".news-card").first()).toBeVisible();
  const sources = await page.getByLabel("Source").locator("option").allTextContents();
  expect(sources.length).toBeGreaterThan(1);
  await page.getByLabel("Source").selectOption(sources[1]);
  const labels = await page.locator(".news-card .label").allTextContents();
  expect(labels.every((l) => l.startsWith(sources[1]))).toBe(true);

  const github = page.getByRole("contentinfo").getByRole("link", { name: /GitHub/ });
  await expect(github).toHaveAttribute("href", "https://github.com/neelsatyavolu/tickerdeck");
  await expect(page.getByRole("contentinfo")).toContainText(/© \d{4} tickerdeck/);
});
