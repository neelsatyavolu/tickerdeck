import { describe, expect, it } from "vitest";
import { parseTheme, THEME_KEY, THEME_SCRIPT, THEMES } from "./theme";

/** Runs the head script against a fake browser and returns the attribute it set. */
function runScript(stored: string | null, storageThrows = false): string | null {
  let attr: string | null = null;
  const localStorage = {
    getItem: (key: string) => {
      if (storageThrows) throw new Error("blocked");
      return key === THEME_KEY ? stored : null;
    },
  };
  const document = { documentElement: { setAttribute: (name: string, value: string) => { if (name === "data-theme") attr = value; } } };
  new Function("localStorage", "document", THEME_SCRIPT)(localStorage, document);
  return attr;
}

describe("parseTheme", () => {
  it("keeps every known theme", () => {
    for (const t of THEMES) expect(parseTheme(t.id)).toBe(t.id);
  });

  it("falls back to system for anything else", () => {
    expect(parseTheme("")).toBe("system");
    expect(parseTheme(null)).toBe("system");
    expect(parseTheme("neon")).toBe("system");
    expect(parseTheme({ id: "ink" })).toBe("system");
  });
});

describe("THEME_SCRIPT", () => {
  it("applies a saved named theme", () => {
    expect(runScript("graphite")).toBe("graphite");
    expect(runScript("paper")).toBe("paper");
  });

  it("leaves the attribute unset for system, nothing saved, or junk", () => {
    expect(runScript("system")).toBeNull();
    expect(runScript(null)).toBeNull();
    expect(runScript('"><script>')).toBeNull();
  });

  it("does nothing when storage is unavailable", () => {
    expect(runScript("ink", true)).toBeNull();
  });
});
