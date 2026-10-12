import { beforeEach, describe, expect, it, vi } from "vitest";

const shared = { get: vi.fn(async () => undefined), set: vi.fn(async () => {}) };
vi.mock("@vercel/functions", () => ({ getCache: () => shared }));

import { clearMemo, memo } from "./cache";

beforeEach(() => {
  clearMemo();
  shared.get.mockClear();
  shared.set.mockClear();
});

describe("memo", () => {
  it("keeps values that live under ten seconds out of the shared cache", async () => {
    expect(await memo("t:index", 5_000, async () => 1)).toBe(1);
    expect(shared.get).not.toHaveBeenCalled();
    expect(shared.set).not.toHaveBeenCalled();
  });

  it("shares longer-lived values across instances", async () => {
    expect(await memo("t:profile", 60_000, async () => 2)).toBe(2);
    expect(shared.get).toHaveBeenCalledWith("t:profile");
    expect(shared.set).toHaveBeenCalledWith("t:profile", 2, { ttl: 60, name: "t:profile" });
  });

  it("serves a repeat call from memory without loading again", async () => {
    const load = vi.fn(async () => 3);
    await memo("t:again", 5_000, load);
    await memo("t:again", 5_000, load);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
