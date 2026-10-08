import { describe, expect, it } from "vitest";
import { alignCloses } from "./align";

const day = (d: string) => Date.parse(`${d}T20:00:00Z`);

describe("alignCloses", () => {
  it("keeps only days present in every series, in date order", () => {
    const a = [{ t: day("2026-01-03"), close: 3 }, { t: day("2026-01-01"), close: 1 }, { t: day("2026-01-02"), close: 2 }];
    const b = [{ t: day("2026-01-01"), close: 10 }, { t: day("2026-01-03"), close: 30 }];
    expect(alignCloses([a, b])).toEqual([[1, 3], [10, 30]]);
  });

  it("handles empty input", () => {
    expect(alignCloses([])).toEqual([]);
  });
});
