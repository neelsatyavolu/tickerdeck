import { describe, expect, it } from "vitest";
import { createSseSplitter, responsesEvent } from "./sse";

describe("createSseSplitter", () => {
  it("reassembles payloads split across chunks and ignores other fields", () => {
    const out: string[] = [];
    const s = createSseSplitter((d) => out.push(d));
    s.push("event: x\ndata: {\"a\"");
    s.push(":1}\r\n\ndata: two\n");
    s.push("data: tail");
    s.flush();
    expect(out).toEqual(['{"a":1}', "two", "tail"]);
  });
});

describe("responsesEvent", () => {
  it("emits text deltas, completion and errors", () => {
    expect(responsesEvent('{"type":"response.output_text.delta","delta":"Hi"}')).toEqual({ text: "Hi" });
    expect(responsesEvent('{"type":"response.completed","response":{}}')).toEqual({ done: true });
    expect(responsesEvent('{"type":"response.completed","response":{"service_tier":"priority"}}')).toEqual({ done: true, tier: "priority" });
    expect(responsesEvent('{"type":"response.failed","response":{"error":{"message":"quota"}}}')).toEqual({ error: "quota" });
    expect(responsesEvent('{"type":"error","message":"bad model"}')).toEqual({ error: "bad model" });
    expect(responsesEvent("[DONE]")).toEqual({ done: true });
  });

  it("ignores unrelated events and junk", () => {
    expect(responsesEvent('{"type":"response.created"}')).toBeNull();
    expect(responsesEvent('{"type":"response.output_item.added","item":{"type":"reasoning"}}')).toBeNull();
    expect(responsesEvent("not json")).toBeNull();
    expect(responsesEvent("")).toBeNull();
  });

  it("reports a search as soon as the model starts one", () => {
    expect(responsesEvent('{"type":"response.output_item.added","item":{"type":"web_search_call","id":"ws_1"}}')).toEqual({ status: "Searching the web" });
    expect(responsesEvent('{"type":"response.output_item.added","item":{"type":"x_search_call"}}')).toEqual({ status: "Searching X" });
  });

  it("returns finished output items without their server-side id", () => {
    const call = { type: "function_call", id: "fc_1", call_id: "c1", name: "get_quotes", arguments: '{"symbols":["NVDA"]}' };
    expect(responsesEvent(JSON.stringify({ type: "response.output_item.done", item: call }))).toEqual({
      item: { type: "function_call", call_id: "c1", name: "get_quotes", arguments: '{"symbols":["NVDA"]}' },
    });
  });

  it("collects web citations from a finished message, keeping only http(s) links", () => {
    const item = {
      type: "message",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: "x",
          annotations: [
            { type: "url_citation", url: "https://example.com/a", title: "A" },
            { type: "url_citation", url: "javascript:alert(1)", title: "bad" },
            { type: "url_citation", url: "https://example.com/b" },
            { type: "file_citation", file_id: "f" },
          ],
        },
      ],
    };
    expect(responsesEvent(JSON.stringify({ type: "response.output_item.done", item }))?.sources).toEqual([
      { url: "https://example.com/a", title: "A" },
      { url: "https://example.com/b", title: null },
    ]);
  });

  it("reads Grok's citation list from the completed response", () => {
    expect(responsesEvent('{"type":"response.completed","response":{"citations":["https://x.com/a/status/1",42]}}')).toEqual({
      done: true,
      sources: [{ url: "https://x.com/a/status/1", title: null }],
    });
  });
});
