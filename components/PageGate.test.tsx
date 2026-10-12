import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PageGate } from "./PageGate";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());

it("reveals usable content while optional forecast and history are pending", () => {
  const html = renderToStaticMarkup(<PageGate title="portfolio" steps={[{ label: "Portfolio", done: true }, { label: "Prices", done: true }, { label: "Forecast", done: false, blocking: false }]}><h1>My portfolio</h1></PageGate>);
  expect(html).not.toContain("progressbar");
  expect(html).not.toContain("visibility:hidden");
  expect(html).toContain('aria-hidden="false"');
});

it("keeps portfolio totals hidden until required prices are settled", () => {
  const html = renderToStaticMarkup(<PageGate title="portfolio" steps={[{ label: "Prices", done: false }]}><h1>My portfolio</h1></PageGate>);
  expect(html).toContain("progressbar");
  expect(html).toContain("visibility:hidden");
});

it("keeps existing callers compatible when every step is required", () => {
  const html = renderToStaticMarkup(<PageGate title="insights" steps={[{ label: "Saved insights", done: true }]}><h1>Insights</h1></PageGate>);
  expect(html).not.toContain("progressbar");
});
