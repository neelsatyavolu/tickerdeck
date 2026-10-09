import { describe, expect, it } from "vitest";
import { weeklyBefore } from "./downsample";

const day = (iso: string) => Date.parse(`${iso}T20:00:00Z`);

describe("weeklyBefore", () => {
  it("collapses older days to each week's last close and summed volume, keeps recent days", () => {
    const points = [
      { t: day("2026-01-05"), close: 10, volume: 1 }, // Mon
      { t: day("2026-01-07"), close: 11, volume: 2 }, // Wed
      { t: day("2026-01-09"), close: 12, volume: 3 }, // Fri
      { t: day("2026-01-12"), close: 13, volume: 4 }, // next Mon
      { t: day("2026-01-13"), close: 14, volume: 5 }, // cutoff day onward stays daily
      { t: day("2026-01-14"), close: 15, volume: 6 },
    ];
    expect(weeklyBefore(points, day("2026-01-13"))).toEqual([
      { t: day("2026-01-09"), close: 12, volume: 6 },
      { t: day("2026-01-12"), close: 13, volume: 4 },
      { t: day("2026-01-13"), close: 14, volume: 5 },
      { t: day("2026-01-14"), close: 15, volume: 6 },
    ]);
  });

  it("leaves a fully recent series alone", () => {
    const points = [{ t: day("2026-10-08"), close: 1 }];
    expect(weeklyBefore(points, day("2020-01-01"))).toEqual(points);
  });
});
