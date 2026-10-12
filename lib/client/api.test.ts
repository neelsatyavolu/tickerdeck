import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const response = (data: unknown) => new Response(JSON.stringify({ ok: true, data }));

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("browser GET cache", () => {
  it("deduplicates a request even when the response takes longer than the TTL", async () => {
    let finish!: (res: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetch);
    const { cachedApi, readCached } = await import("./api");
    const first = cachedApi<{ price: number }>("/slow", 1000);
    vi.advanceTimersByTime(2000);
    expect(cachedApi("/slow", 1000)).toBe(first);
    expect(readCached("/slow")).toBeUndefined();
    finish(response({ price: 12 }));
    await expect(first).resolves.toEqual({ price: 12 });
    vi.advanceTimersByTime(999);
    expect(cachedApi("/slow", 1000)).toBe(first);
    expect(readCached("/slow")).toEqual({ price: 12 });
    vi.advanceTimersByTime(2);
    expect(readCached("/slow")).toBeUndefined();
    cachedApi("/slow", 1000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries rejected loads and keeps ordinary api reads uncached", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(response(null));
    vi.stubGlobal("fetch", fetch);
    const { cachedApi, api, peekCached } = await import("./api");
    await expect(cachedApi("/retry", 1000)).rejects.toThrow("Network error");
    expect(peekCached("/retry")).toBeNull();
    await expect(cachedApi("/retry", 1000)).resolves.toBeNull();
    fetch.mockImplementation(() => Promise.resolve(response(null)));
    await api("/retry");
    await api("/retry");
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
