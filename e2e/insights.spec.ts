import { expect, test } from "@playwright/test";

// The AI insights tab: a saved set shows at once, Refresh writes a new one,
// and a category narrows the cards. The model is faked: the saved set and the
// refresh are answered in the browser.

test.skip(!process.env.E2E_BASE_URL && !process.env.NEON_AUTH_BASE_URL, "Set E2E_BASE_URL or the Neon env");

const insight = (over: object) => ({ category: "Risk", title: "AAPL is all of your watchlist", body: "Everything you follow is one stock.", symbols: ["AAPL"], tone: "down", sources: [], ...over });
const set = (insights: object[], generated_at: string) => ({ ok: true, data: { insights, generated_at, provider: "codex", model: "gpt-test" } });

test("saved insights, refresh and category filter", async ({ page }) => {
  const saved = set(
    [insight({}), insight({ category: "Market", title: "Stocks slipped 1.2%", body: "The S&P 500 fell on rate worries.", symbols: [], tone: "neutral", sources: [{ url: "https://example.com/markets", title: "Markets wrap" }] })],
    new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
  );
  const fresh = set([insight({ category: "Movers", title: "AAPL rose 3% on earnings", tone: "up" })], new Date().toISOString());
  const posts: object[] = [];
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));

  await page.route("**/api/ai/status", (route) => route.fulfill({ json: { codex: true, grok: false } }));
  await page.route("**/api/ai/insights", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: saved });
    posts.push(route.request().postDataJSON());
    await held;
    return route.fulfill({ json: fresh });
  });

  await page.goto("/login");
  await page.getByRole("button", { name: "Create an account instead" }).click();
  await page.getByLabel("Email").fill(`e2e-insights+${Date.now()}@tickerdeck.test`);
  await page.getByLabel("Password").fill(`e2e-${Math.random().toString(36).slice(2)}-pass`);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening)$/ })).toBeVisible({ timeout: 30_000 });

  // Watch a stock so there is something to write about.
  await page.goto("/s/AAPL");
  await page.getByRole("button", { name: "Watch", exact: true }).click();
  await expect(page.getByRole("button", { name: "Watching", exact: true })).toBeVisible();

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "AI insights" }).click();
  await expect(page.getByRole("heading", { name: "AI insights", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Written 2h ago by ChatGPT \(gpt-test\)/)).toBeVisible();
  await expect(page.locator(".insight-card")).toHaveCount(2);
  await expect(page.getByRole("link", { name: "AAPL", exact: true })).toHaveAttribute("href", "/s/AAPL");
  await expect(page.getByRole("link", { name: "Markets wrap" })).toHaveAttribute("href", "https://example.com/markets");
  await expect(page.getByText("none of this is financial advice")).toBeVisible();
  // A set written two hours ago is not rewritten just by opening the page.
  expect(posts).toHaveLength(0);
  await page.screenshot({ path: "test-results/insights.png" });

  // One category at a time.
  await page.getByRole("button", { name: "Market", exact: true }).click();
  await expect(page.locator(".insight-card")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Stocks slipped 1.2%" })).toBeVisible();

  // Refresh keeps the old set on screen until the new one arrives.
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("button", { name: "Writing…" })).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("about a minute");
  await expect(page.getByRole("heading", { name: "Stocks slipped 1.2%" })).toBeVisible();
  release();
  await expect(page.getByRole("heading", { name: "AAPL rose 3% on earnings" })).toBeVisible();
  await expect(page.locator(".insight-card")).toHaveCount(1);
  expect(posts).toEqual([{ provider: "codex", effort: "low", fast: false }]);
});
