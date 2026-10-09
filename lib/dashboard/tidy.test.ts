import { describe, expect, it } from "vitest";
import type { Panel } from "./schema";
import { fillRow, isTidy, rows, tidyLayout } from "./tidy";

const p = (width: Panel["width"], id = String(Math.random())): Panel => ({ id, type: "tiles", symbols: ["AAPL"], width });

describe("rows", () => {
  it("wraps like the 12-column grid", () => {
    expect(rows([p(8), p(6), p(6), p(3), p(12)]).map((r) => r.map((x) => x.width))).toEqual([[8], [6, 6], [3], [12]]);
  });
});

describe("fillRow", () => {
  it("widens as little as possible, preferring later panels", () => {
    expect(fillRow([8])).toEqual([12]);
    expect(fillRow([4, 4])).toEqual([4, 8]);
    expect(fillRow([6, 3])).toEqual([6, 6]);
    expect(fillRow([8, 3])).toEqual([8, 4]);
    expect(fillRow([3, 3, 3])).toEqual([3, 3, 6]);
    expect(fillRow([6, 6])).toEqual([6, 6]);
  });
});

describe("tidyLayout", () => {
  it("fills every row without reordering", () => {
    const before = [p(12, "a"), p(8, "b"), p(6, "c"), p(3, "d"), p(4, "e")];
    const after = tidyLayout(before);
    expect(after.map((x) => x.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(after.map((x) => x.width)).toEqual([12, 12, 6, 6, 12]);
    expect(isTidy(after)).toBe(true);
    expect(isTidy(before)).toBe(false);
  });
});
