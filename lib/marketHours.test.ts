import { describe, expect, it } from "vitest";
import { marketStatus, session } from "./marketHours";

// Times in UTC; New York is UTC-4 in October.
describe("marketStatus", () => {
  it("knows the regular session", () => {
    expect(marketStatus(new Date("2026-10-09T15:00:00Z")).open).toBe(true); // Fri 11:00 ET
    expect(marketStatus(new Date("2026-10-09T13:00:00Z")).label).toMatch(/Pre-market/); // Fri 9:00 ET
    expect(marketStatus(new Date("2026-10-09T20:30:00Z")).label).toMatch(/closed · opens Monday/); // Fri 4:30 PM ET
    expect(marketStatus(new Date("2026-10-07T21:00:00Z")).label).toMatch(/opens tomorrow/); // Wed 5 PM ET
    expect(marketStatus(new Date("2026-10-11T15:00:00Z")).open).toBe(false); // Sunday
  });
});

describe("session", () => {
  it("splits the day into pre-market, regular, after hours and closed", () => {
    expect(session(new Date("2026-10-09T12:00:00Z"))).toBe("pre"); // Fri 8:00 ET
    expect(session(new Date("2026-10-09T15:00:00Z"))).toBe("regular");
    expect(session(new Date("2026-10-09T21:00:00Z"))).toBe("after"); // Fri 5:00 PM ET
    expect(session(new Date("2026-10-10T01:00:00Z"))).toBe("closed"); // Fri 9:00 PM ET
    expect(session(new Date("2026-10-10T15:00:00Z"))).toBe("closed"); // Saturday
  });
});
