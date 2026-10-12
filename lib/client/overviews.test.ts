import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const overview = { spark: [1, 2], r1m: 0.1, r3m: 0.2, ytd: 0.3, r1y: 0.4, high52: 2, low52: 1 };
const respond = (url: string) => new Response(JSON.stringify({ ok: true, data: Object.fromEntries(new URL(url, "http://test").searchParams.get("symbols")!.split(",").map((s) => [s, overview])) }));

it("shares pending symbols across overlapping panels and only requests additions", async () => {
  const pending: (() => void)[] = [];
  const fetch = vi.fn((url: string) => new Promise<Response>((resolve) => pending.push(() => resolve(respond(url)))));
  vi.stubGlobal("fetch", fetch);
  const { loadOverviews } = await import("./overviews");
  const first = loadOverviews(["AAPL", "MSFT", "AAPL"]);
  const second = loadOverviews(["MSFT", "NVDA"]);
  expect(fetch.mock.calls.map(([url]) => new URL(url, "http://test").searchParams.get("symbols"))).toEqual(["AAPL,MSFT", "NVDA"]);
  pending.forEach((finish) => finish());
  await expect(first).resolves.toEqual({ AAPL: overview, MSFT: overview });
  await expect(second).resolves.toEqual({ MSFT: overview, NVDA: overview });
  await loadOverviews(["NVDA", "AAPL"]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("stays within the route's 50-symbol limit", async () => {
  const fetch = vi.fn(async (url: string) => respond(url));
  vi.stubGlobal("fetch", fetch);
  const { loadOverviews } = await import("./overviews");
  expect(Object.keys(await loadOverviews(Array.from({ length: 52 }, (_, i) => `S${i}`)))).toHaveLength(52);
  expect(fetch.mock.calls.map(([url]) => new URL(url, "http://test").searchParams.get("symbols")!.split(",").length)).toEqual([50, 2]);
});

it("retries failed batches and expires successful symbol entries", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn<(url: string) => Promise<Response>>().mockRejectedValueOnce(new Error("offline")).mockImplementation(async (url) => respond(url));
  vi.stubGlobal("fetch", fetch);
  const { loadOverviews } = await import("./overviews");
  await expect(loadOverviews(["AAPL"])).rejects.toThrow("Network error");
  await loadOverviews(["AAPL"]);
  await loadOverviews(["AAPL"]);
  expect(fetch).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(5 * 60_000 + 1);
  await loadOverviews(["AAPL"]);
  expect(fetch).toHaveBeenCalledTimes(3);
});
