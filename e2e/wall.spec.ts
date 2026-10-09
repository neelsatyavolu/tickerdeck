import { expect, test } from "@playwright/test";

// Settings sign-in opens in a new tab; the assistant floats bottom-right; the
// wall layout fills the screen with one chart per watched symbol.

test.skip(!process.env.E2E_BASE_URL && !process.env.NEON_AUTH_BASE_URL, "Set E2E_BASE_URL or the Neon env");

test("sign-in link, assistant window, and the everything wall", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/login");
  await page.getByRole("button", { name: "Create an account instead" }).click();
  await page.getByLabel("Email").fill(`e2e-wall+${Date.now()}@tickerdeck.test`);
  await page.getByLabel("Password").fill(`e2e-${Math.random().toString(36).slice(2)}-pass`);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("All portfolios")).toBeVisible();

  // ChatGPT sign-in is a real link that opens a new tab.
  await page.getByRole("link", { name: "Settings" }).click();
  const connect = page.getByRole("link", { name: /Connect ChatGPT/ });
  await expect(connect).toHaveAttribute("target", "_blank");
  await expect(connect).toHaveAttribute("href", /^https:\/\/auth\.openai\.com\/oauth\/authorize\?/);

  // Assistant defaults: effort and ChatGPT Fast mode persist across reloads.
  await page.getByRole("group", { name: "ChatGPT reasoning effort" }).getByRole("button", { name: "High", exact: true }).click();
  await page.getByRole("switch", { name: "ChatGPT Fast mode" }).click();
  await page.reload();
  await expect(page.getByRole("switch", { name: "ChatGPT Fast mode" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("group", { name: "ChatGPT reasoning effort" }).getByRole("button", { name: "High", exact: true })).toHaveAttribute("aria-pressed", "true");

  // The assistant is a window in the bottom-right corner.
  await page.getByRole("button", { name: /^Ask AI/ }).click();
  const box = await page.getByRole("dialog", { name: "AI assistant" }).boundingBox();
  expect(box).not.toBeNull();
  expect(1400 - (box!.x + box!.width)).toBeLessThan(40);
  expect(900 - (box!.y + box!.height)).toBeLessThan(40);
  expect(box!.width).toBeLessThan(520);
  await page.keyboard.press("Escape");

  // Wall from the watchlist: heatmap plus one chart per symbol.
  for (const s of ["AAPL", "MSFT", "VTSAX", "^GSPC", "DHT"]) {
    await page.evaluate((sym) => fetch("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: sym }) }), s);
  }
  await page.goto("/d");
  const card = page.locator(".grid-cells > div").filter({ hasText: "Everything wall" });
  await card.getByLabel("Symbols for the wall").selectOption("watchlist");
  await card.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "Watchlist wall" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".dash-panel")).toHaveCount(6);
  for (const s of ["AAPL", "VTSAX", "^GSPC"]) await expect(page.getByRole("img", { name: new RegExp(`^${s.replace("^", "\\^")} price`) })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Full screen" })).toBeVisible();
});
