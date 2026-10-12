import { expect, test } from "@playwright/test";

// The assistant shows what it is doing while it searches, then the answer and
// the pages it cited. The model is faked in the browser: the stream pauses
// after the status line so the test can see it.

test.skip(!process.env.E2E_BASE_URL && !process.env.NEON_AUTH_BASE_URL, "Set E2E_BASE_URL or the Neon env");

type FakeWindow = Window & { chatBodies: { messages: object[] }[]; releaseAnswer: () => void };

test("search status, answer and sources", async ({ page }) => {
  await page.route("**/api/ai/status", (route) => route.fulfill({ json: { codex: true, grok: false } }));
  await page.route("**/api/ai/models", (route) => route.fulfill({ json: { codex: [{ id: "gpt-test", label: "GPT Test" }], grok: [] } }));
  await page.addInitScript(() => {
    const w = window as unknown as FakeWindow;
    const realFetch = window.fetch.bind(window);
    w.chatBodies = [];
    window.fetch = (input, init) => {
      if (!String(input).endsWith("/api/ai/chat")) return realFetch(input, init);
      w.chatBodies.push(JSON.parse(String(init?.body)));
      const line = (obj: object) => new TextEncoder().encode(JSON.stringify(obj) + "\n");
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(line({ s: "Searching the web" }));
          await new Promise<void>((resolve) => (w.releaseAnswer = resolve));
          controller.enqueue(line({ t: "Nvidia rose on earnings." }));
          controller.enqueue(line({ src: [{ url: "https://example.com/nvda", title: "Nvidia beats estimates" }, { url: "javascript:alert(1)", title: "Bad link" }] }));
          controller.enqueue(line({ done: true }));
          controller.close();
        },
      });
      return Promise.resolve(new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } }));
    };
  });

  await page.goto("/login");
  await page.getByRole("button", { name: "Create an account instead" }).click();
  await page.getByLabel("Email").fill(`e2e-assistant+${Date.now()}@tickerdeck.test`);
  await page.getByLabel("Password").fill(`e2e-${Math.random().toString(36).slice(2)}-pass`);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening)$/ })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: /^Ask AI/ }).click();
  const sheet = page.getByRole("dialog", { name: "AI assistant" });
  await expect(sheet.getByText("search the web")).toBeVisible();

  await sheet.getByLabel("Message").fill("What moved NVDA today?");
  await sheet.getByRole("button", { name: "Send" }).click();
  await expect(sheet.getByText("Searching the web")).toBeVisible();

  await page.evaluate(() => (window as unknown as FakeWindow).releaseAnswer());
  await expect(sheet.getByText("Nvidia rose on earnings.")).toBeVisible();
  await expect(sheet.getByText("Searching the web")).toBeHidden();
  const source = sheet.getByRole("link", { name: "Nvidia beats estimates" });
  await expect(source).toHaveAttribute("href", "https://example.com/nvda");
  await expect(source).toHaveAttribute("target", "_blank");
  await expect(sheet.getByText("(example.com)")).toBeVisible();
  await expect(sheet.getByText("Bad link")).toHaveCount(0);

  // A follow-up sends the conversation as plain text, without the sources.
  await sheet.getByLabel("Message").fill("And AMD?");
  await sheet.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as FakeWindow).chatBodies.length)).toBe(2);
  const second = await page.evaluate(() => (window as unknown as FakeWindow).chatBodies[1]);
  expect(second.messages).toEqual([
    { role: "user", content: "What moved NVDA today?" },
    { role: "assistant", content: "Nvidia rose on earnings." },
    { role: "user", content: "And AMD?" },
  ]);
});
