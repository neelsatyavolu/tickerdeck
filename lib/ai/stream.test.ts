import { afterEach, describe, expect, it, vi } from "vitest";
import { collectText, streamChat } from "./stream";

const tokens = { accessToken: "tok", refreshToken: "r", expiresAt: Date.now() + 60_000, accountId: "acct" };

function sseResponse(chunks: string[], status = 200): Response {
  const body = new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch));
      c.close();
    },
  });
  return new Response(body, { status });
}

afterEach(() => vi.unstubAllGlobals());

describe("streamChat", () => {
  it("streams Codex deltas and sends account headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"type":"response.output_text.delta","delta":"Hel"}\n\n',
        'data: {"type":"response.output_text.delta","delta":"lo"}\n\ndata: {"type":"response.completed"}\n\n',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const out = await collectText(streamChat({ provider: "codex", tokens, model: "gpt-6-astra", system: "sys", messages: [{ role: "user", content: "hi" }] }));
    expect(out).toEqual({ text: "Hello", error: null, tier: null });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("chatgpt.com/backend-api/codex/responses");
    expect(init.headers["chatgpt-account-id"]).toBe("acct");
    expect(JSON.parse(init.body)).toMatchObject({ model: "gpt-6-astra", instructions: "sys", stream: true, store: false });
  });

  it("streams Grok chat chunks with the system prompt first", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse(['data: {"choices":[{"delta":{"content":"A"}}]}\n', 'data: {"choices":[{"delta":{"content":"B"}}]}\ndata: [DONE]\n']),
    );
    vi.stubGlobal("fetch", fetchMock);
    const out = await collectText(streamChat({ provider: "grok", tokens, model: "grok-4.7", system: "sys", messages: [{ role: "user", content: "hi" }] }));
    expect(out.text).toBe("AB");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[0]).toEqual({ role: "system", content: "sys" });
  });

  it("turns an expired token into a reconnect message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 401 })));
    const out = await collectText(streamChat({ provider: "grok", tokens, model: "grok-4.7", system: "", messages: [{ role: "user", content: "x" }] }));
    expect(out.error).toMatch(/Reconnect/);
  });

  it("sends the chosen effort and Fast mode to ChatGPT, and reports the tier used", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse(['data: {"type":"response.output_text.delta","delta":"ok"}\n\n', 'data: {"type":"response.completed","response":{"service_tier":"priority"}}\n\n']),
    );
    vi.stubGlobal("fetch", fetchMock);
    const out = await collectText(streamChat({ provider: "codex", tokens, model: "gpt-6-astra", system: "", messages: [{ role: "user", content: "x" }], effort: "high", fast: true }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ reasoning: { effort: "high" }, service_tier: "priority" });
    expect(out).toMatchObject({ text: "ok", tier: "priority" });
  });

  it("retries without Fast mode when the backend rejects it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Unsupported service_tier: priority" } }), { status: 400 }))
      .mockResolvedValueOnce(sseResponse(['data: {"type":"response.output_text.delta","delta":"fine"}\n\n']));
    vi.stubGlobal("fetch", fetchMock);
    const out = await collectText(streamChat({ provider: "codex", tokens, model: "m", system: "", messages: [{ role: "user", content: "x" }], fast: true }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).service_tier).toBeUndefined();
    expect(out).toMatchObject({ text: "fine", tier: "default", error: null });
  });

  it("clamps Grok's effort to what it supports and never sends Fast mode", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(["data: [DONE]\n"]));
    vi.stubGlobal("fetch", fetchMock);
    await collectText(streamChat({ provider: "grok", tokens, model: "grok-4.7", system: "", messages: [{ role: "user", content: "x" }], effort: "xhigh", fast: true }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.reasoning).toEqual({ effort: "high" });
    expect(body.service_tier).toBeUndefined();
  });

  it("aborts the upstream request when the client cancels", async () => {
    let upstreamSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      upstreamSignal = init.signal ?? undefined;
      return Promise.resolve(sseResponse(['data: {"type":"response.output_text.delta","delta":"x"}\n\n']));
    }));
    const stream = streamChat({ provider: "codex", tokens, model: "m", system: "", messages: [{ role: "user", content: "x" }] });
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();
    expect(upstreamSignal?.aborted).toBe(true);
  });

  it("reports network failures without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await collectText(streamChat({ provider: "codex", tokens, model: "m", system: "", messages: [{ role: "user", content: "x" }] }));
    expect(out).toEqual({ text: "", error: "Could not reach the model.", tier: null });
  });
});
