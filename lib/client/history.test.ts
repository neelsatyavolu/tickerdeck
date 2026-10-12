import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());
const DAY = 86_400_000;
const points = Array.from({ length: 1000 }, (_, i) => ({ t: i * DAY, close: 100 + i }));

it("requests the short chart window instead of ten years", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: points.slice(-93) })));
  vi.stubGlobal("fetch", fetch);
  const { loadHistory, readHistory } = await import("./history");
  expect(readHistory("AAPL", "3mo")).toBeUndefined();
  await expect(loadHistory("AAPL", "3mo")).resolves.toHaveLength(93);
  expect(readHistory("AAPL", "3mo")).toEqual(points.slice(-93));
  expect(fetch).toHaveBeenCalledWith("/api/market/history?symbol=AAPL&range=3mo", undefined);
});

it("reuses a wider in-flight request for other ranges and never truncates a wider request", async () => {
  let finish!: (value: Response) => void;
  const fetch = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
  vi.stubGlobal("fetch", fetch);
  const { loadHistory, readHistory } = await import("./history");
  const wide = loadHistory("BRK.B", "10y");
  const short = loadHistory("BRK.B", "3mo");
  expect(fetch).toHaveBeenCalledTimes(1);
  finish(new Response(JSON.stringify({ ok: true, data: points })));
  await expect(wide).resolves.toEqual(points);
  await expect(short).resolves.toEqual(points.slice(-93));
  expect(readHistory("BRK.B", "3mo")).toEqual(points.slice(-93));
  await expect(loadHistory("BRK.B", "10y")).resolves.toEqual(points);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("fetches a wider series when only a shorter window is cached", async () => {
  const fetch = vi.fn<(url: string) => Promise<Response>>().mockImplementation(async () => new Response(JSON.stringify({ ok: true, data: points })));
  vi.stubGlobal("fetch", fetch);
  const { loadHistory } = await import("./history");
  await loadHistory("AAPL", "3mo");
  await loadHistory("AAPL", "1y");
  expect(fetch.mock.calls.map((call) => call[0])).toEqual(["/api/market/history?symbol=AAPL&range=3mo", "/api/market/history?symbol=AAPL&range=1y"]);
});
