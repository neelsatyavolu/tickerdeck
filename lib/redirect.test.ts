import { describe, expect, it } from "vitest";
import { safeNext } from "./redirect";

const origin = "https://tickerquill.vercel.app";

describe("safeNext", () => {
  it("keeps same-origin paths", () => {
    expect(safeNext("/p/123?x=1", origin).href).toBe(`${origin}/p/123?x=1`);
    expect(safeNext(null, origin).href).toBe(`${origin}/`);
  });

  it("rejects off-site targets, including backslash and protocol-relative tricks", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "\\\\evil.com", "https://evil.com", "javascript:alert(1)"]) {
      expect(safeNext(bad, origin).href).toBe(`${origin}/`);
    }
  });
});
