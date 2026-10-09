import { describe, expect, it } from "vitest";
import { chatEvent, codexEvent, createSseSplitter } from "./sse";

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

describe("codexEvent", () => {
  it("emits text deltas, completion and errors", () => {
    expect(codexEvent('{"type":"response.output_text.delta","delta":"Hi"}')).toEqual({ text: "Hi" });
    expect(codexEvent('{"type":"response.completed","response":{}}')).toEqual({ done: true });
    expect(codexEvent('{"type":"response.completed","response":{"service_tier":"priority"}}')).toEqual({ done: true, tier: "priority" });
    expect(codexEvent('{"type":"response.failed","response":{"error":{"message":"quota"}}}')).toEqual({ error: "quota" });
    expect(codexEvent('{"type":"error","message":"bad model"}')).toEqual({ error: "bad model" });
  });

  it("ignores unrelated events and junk", () => {
    expect(codexEvent('{"type":"response.created"}')).toBeNull();
    expect(codexEvent("not json")).toBeNull();
    expect(codexEvent("")).toBeNull();
  });
});

describe("chatEvent", () => {
  it("reads OpenAI-style chunks", () => {
    expect(chatEvent('{"choices":[{"delta":{"content":"Yo"}}]}')).toEqual({ text: "Yo" });
    expect(chatEvent('{"choices":[{"delta":{"role":"assistant"}}]}')).toBeNull();
    expect(chatEvent("[DONE]")).toEqual({ done: true });
    expect(chatEvent('{"error":{"message":"rate limit"}}')).toEqual({ error: "rate limit" });
  });
});
