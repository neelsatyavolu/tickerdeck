import { describe, expect, it } from "vitest";
import { isCrossSite } from "./csrf";

const req = (method: string, headers: Record<string, string>) => ({ method, headers: new Headers(headers), nextUrl: { host: "tickerquill.vercel.app" } });

describe("isCrossSite", () => {
  it("lets reads and same-origin writes through", () => {
    expect(isCrossSite(req("GET", { "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isCrossSite(req("POST", { "sec-fetch-site": "same-origin" }))).toBe(false);
    expect(isCrossSite(req("POST", { origin: "https://tickerquill.vercel.app", host: "tickerquill.vercel.app" }))).toBe(false);
    expect(isCrossSite(req("DELETE", {}))).toBe(false);
  });

  it("blocks cross-site and same-site writes", () => {
    expect(isCrossSite(req("POST", { "sec-fetch-site": "cross-site" }))).toBe(true);
    expect(isCrossSite(req("PATCH", { "sec-fetch-site": "same-site" }))).toBe(true);
    expect(isCrossSite(req("POST", { origin: "https://evil.example", host: "tickerquill.vercel.app" }))).toBe(true);
    expect(isCrossSite(req("POST", { origin: "null", host: "tickerquill.vercel.app" }))).toBe(true);
  });
});
