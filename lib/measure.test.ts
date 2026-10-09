import { describe, expect, it } from "vitest";
import { measure } from "./measure";

const pts = [{ t: 0, v: 100 }, { t: 86_400_000 * 10, v: 120 }, { t: 86_400_000 * 30, v: 90 }];

describe("measure", () => {
  it("measures earlier to later whichever way you drag", () => {
    const m = measure(pts, 2, 0);
    expect(m).toMatchObject({ lo: 0, hi: 2, change: -10, days: 30 });
    expect(m.pct).toBeCloseTo(-0.1);
    expect(measure(pts, 0, 1).pct).toBeCloseTo(0.2);
  });
});
