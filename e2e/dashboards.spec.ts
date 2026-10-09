import { expect, test } from "@playwright/test";

// Build a dashboard from a layout, check its panels render, add and reorder a
// panel, reload to confirm it saved, then delete it.

test.skip(!process.env.E2E_BASE_URL && !process.env.NEON_AUTH_BASE_URL, "Set E2E_BASE_URL or the Neon env");

test("dashboards from layouts, with editable panels", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Create an account instead" }).click();
  await page.getByLabel("Email").fill(`e2e-dash+${Date.now()}@tickerdeck.test`);
  await page.getByLabel("Password").fill(`e2e-${Math.random().toString(36).slice(2)}-pass`);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("All portfolios")).toBeVisible();

  await page.getByRole("link", { name: "Dashboards" }).click();
  await expect(page.getByRole("heading", { name: "Dashboards", exact: true })).toBeVisible();
  await page.locator(".grid-cells > div").filter({ hasText: "Market overview" }).getByRole("button", { name: "Use this layout" }).click();

  await expect(page.getByRole("heading", { name: "Market overview" })).toBeVisible({ timeout: 30_000 });
  const indexes = page.getByRole("region", { name: "Indexes", exact: true });
  await expect(indexes).toContainText("^GSPC");
  await expect(indexes).toContainText(/\d{1,3}(,\d{3})+\.\d{2}/); // index levels are points, not dollars
  await expect(page.getByRole("img", { name: /^Change since/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Mega caps today" }).getByRole("listitem").first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Market news" }).locator("article").first()).toBeVisible({ timeout: 30_000 });

  // Add a price panel for AAPL.
  await page.getByRole("button", { name: "Add panel" }).click();
  await page.getByRole("radio", { name: "Price chart" }).click();
  await page.getByPlaceholder("Add a symbol").fill("AAPL");
  await page.getByRole("option", { name: /^AAPL/ }).first().click();
  await page.getByLabel("Title (optional)").fill("Apple 1Y");
  await page.getByRole("button", { name: "Add panel", exact: true }).last().click();
  const apple = page.getByRole("region", { name: "Apple 1Y" });
  await expect(apple.getByRole("img", { name: /AAPL price/ })).toBeVisible({ timeout: 30_000 });

  // Move it to the front with the buttons (dragging is covered on the watchlist).
  const titles = async () => page.locator(".dash-panel").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  for (let k = 0; k < 6; k++) await apple.getByRole("button", { name: "Move panel earlier" }).click();
  await expect.poll(async () => (await titles())[0]).toBe("Apple 1Y");
  await page.getByRole("button", { name: "Done" }).click();
  // Wait until the server has the new order before reloading.
  const dashId = new URL(page.url()).pathname.split("/").pop();
  await expect
    .poll(() => page.evaluate(async (id) => (await (await fetch(`/api/dashboards/${id}`)).json()).data.panels[0]?.title, dashId))
    .toBe("Apple 1Y");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Market overview" })).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await titles())[0]).toBe("Apple 1Y");
  expect((await titles()).length).toBe(7);

  // Deep-dive layout for a specific ticker.
  await page.goto("/d");
  const deepDive = page.locator(".grid-cells > div").filter({ hasText: "Single-stock deep dive" });
  await deepDive.getByPlaceholder("Pick a ticker").fill("DHT");
  await page.getByRole("option", { name: /^DHT/ }).first().click();
  await deepDive.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name: "DHT deep dive" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("img", { name: /DHT price/ })).toBeVisible({ timeout: 30_000 });

  // One click from a stock page adds its chart to the last dashboard used.
  await page.goto("/s/MSFT");
  await page.getByRole("button", { name: /^Add chart → DHT deep dive/ }).click();
  await expect(page.getByText("Added.")).toBeVisible();
  await page.getByRole("link", { name: "Open dashboard" }).click();
  await expect(page.getByRole("region", { name: "MSFT" })).toBeVisible({ timeout: 30_000 });

  // Delete both.
  for (const name of ["DHT deep dive", "Market overview"]) {
    await page.goto("/d");
    await page.getByRole("link", { name: new RegExp(name) }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Dashboards", exact: true })).toBeVisible();
  }
  await expect(page.getByText("0 dashboards")).toBeVisible();
});
