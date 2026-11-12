import { describe, expect, it } from "vitest";
import { syncSummary } from "./summary";

const skip = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `S${i + 1}`, reason: "cash" }));

describe("syncSummary", () => {
  it("counts positions and portfolios", () => {
    expect(syncSummary({ portfolios: 2, lots: 14, skipped: [] })).toBe("Synced 14 positions into 2 portfolios.");
    expect(syncSummary({ portfolios: 1, lots: 1, skipped: [] })).toBe("Synced 1 position into 1 portfolio.");
  });

  it("names what was skipped and why", () => {
    expect(syncSummary({ portfolios: 1, lots: 3, skipped: [{ name: "US Dollar", reason: "cash" }, { name: "BTC", reason: "crypto" }] })).toBe(
      "Synced 3 positions into 1 portfolio. Skipped 2 that tickerdeck can't track: US Dollar (cash), BTC (crypto).",
    );
  });

  it("shortens a long skipped list", () => {
    expect(syncSummary({ portfolios: 1, lots: 0, skipped: skip(8) })).toBe(
      "Synced 0 positions into 1 portfolio. Skipped 8 that tickerdeck can't track: S1 (cash), S2 (cash), S3 (cash), S4 (cash), S5 (cash) and 3 more.",
    );
  });
});
