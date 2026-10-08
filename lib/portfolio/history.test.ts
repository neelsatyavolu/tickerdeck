import { describe, expect, it } from "vitest";
import { holdingsValueSeries } from "./history";

const at = (d: string) => Date.parse(`${d}T20:00:00Z`);

describe("holdingsValueSeries", () => {
  it("weights closes by shares over shared days", () => {
    const series = holdingsValueSeries(
      {
        A: [{ t: at("2026-01-01"), close: 10 }, { t: at("2026-01-02"), close: 11 }, { t: at("2026-01-05"), close: 12 }],
        B: [{ t: at("2026-01-02"), close: 100 }, { t: at("2026-01-05"), close: 90 }],
      },
      { A: 2, B: 1 },
    );
    expect(series).toEqual([{ t: at("2026-01-02"), v: 122 }, { t: at("2026-01-05"), v: 114 }]);
  });

  it("ignores zero-share and missing symbols", () => {
    expect(holdingsValueSeries({ A: [{ t: at("2026-01-01"), close: 5 }] }, { A: 0, Z: 3 })).toEqual([]);
  });
});
