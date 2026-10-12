import { afterEach, describe, expect, it, vi } from "vitest";
import { collectText, streamChat } from "./stream";

const tools = vi.hoisted(() => ({ prepareTool: vi.fn() }));
vi.mock("./tools", () => ({
  TOOL_SPECS: [{ type: "function", name: "get_quotes", description: "Live quotes", parameters: { type: "object" }, strict: false }],
  prepareTool: tools.prepareTool,
}));

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

/** Every NDJSON line the stream sent to the browser. */
async function lines(stream: ReadableStream<Uint8Array>): Promise<Record<string, unknown>[]> {
  const raw = await new Response(stream).text();
  return raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

const event = (e: object) => `data: ${JSON.stringify(e)}\n\n`;
const quoteCall = { type: "function_call", id: "fc_1", call_id: "c1", name: "get_quotes", arguments: '{"symbols":["NVDA"]}' };
const ask = (provider: "codex" | "grok" = "codex") =>
  streamChat({ provider, tokens, model: provider === "codex" ? "gpt-6-astra" : "grok-4.7", system: "sys", messages: [{ role: "user", content: "hi" }] });

afterEach(() => {
  vi.unstubAllGlobals();
  tools.prepareTool.mockReset();
});

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

  it("streams Grok through xAI's Responses endpoint with the system prompt first", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse(['data: {"type":"response.output_text.delta","delta":"A"}\n', 'data: {"type":"response.output_text.delta","delta":"B"}\ndata: [DONE]\n']),
    );
    vi.stubGlobal("fetch", fetchMock);
    const out = await collectText(ask("grok"));
    expect(out.text).toBe("AB");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/responses");
    expect(JSON.parse(init.body).input).toEqual([{ role: "system", content: "sys" }, { role: "user", content: "hi" }]);
  });

  it("sends a user's screenshots to either provider as image parts", async () => {
    const image = "data:image/png;base64,iVBORw0KGgo=";
    const messages = [
      { role: "user" as const, content: "what is this?", images: [image] },
      { role: "assistant" as const, content: "A chart." },
      { role: "user" as const, content: "", images: [image] },
    ];
    const parts = [{ type: "input_image", image_url: image }];
    for (const provider of ["codex", "grok"] as const) {
      const fetchMock = vi.fn().mockResolvedValue(sseResponse(["data: [DONE]\n"]));
      vi.stubGlobal("fetch", fetchMock);
      await collectText(streamChat({ provider, tokens, model: "m", system: "sys", messages }));
      const input = JSON.parse(fetchMock.mock.calls[0][1].body).input.filter((m: { role: string }) => m.role === "user");
      expect(input).toEqual([
        { role: "user", content: [{ type: "input_text", text: "what is this?" }, ...parts] },
        { role: "user", content: parts },
      ]);
    }
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

  it("offers each provider's built-in web search alongside the data tools", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(sseResponse(["data: [DONE]\n"])));
    vi.stubGlobal("fetch", fetchMock);
    await collectText(ask("codex"));
    await collectText(ask("grok"));
    const [codex, grok] = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(codex.tools.map((t: { type: string; name?: string }) => t.name ?? t.type)).toEqual(["web_search", "get_quotes"]);
    expect(grok.tools.map((t: { type: string; name?: string }) => t.name ?? t.type)).toEqual(["web_search", "x_search", "get_quotes"]);
    expect(codex.include).toEqual(["reasoning.encrypted_content"]);
    expect(codex.tool_choice).toBeUndefined();
  });

  it("runs the tool the model asks for and sends the result back", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sseResponse([event({ type: "response.output_item.done", item: quoteCall }), event({ type: "response.completed", response: {} })]))
      .mockResolvedValueOnce(sseResponse([event({ type: "response.output_text.delta", delta: "NVDA is $110." }), event({ type: "response.completed", response: {} })]));
    vi.stubGlobal("fetch", fetchMock);
    tools.prepareTool.mockReturnValue({ status: "Getting quotes for NVDA", run: () => Promise.resolve("NVDA: $110.00") });

    const out = await lines(ask());
    expect(out).toEqual([{ s: "Getting quotes for NVDA" }, { t: "NVDA is $110." }, { done: true }]);
    expect(tools.prepareTool).toHaveBeenCalledWith("get_quotes", '{"symbols":["NVDA"]}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const followUp = JSON.parse(fetchMock.mock.calls[1][1].body).input;
    expect(followUp.slice(-2)).toEqual([
      { type: "function_call", call_id: "c1", name: "get_quotes", arguments: '{"symbols":["NVDA"]}' },
      { type: "function_call_output", call_id: "c1", output: "NVDA: $110.00" },
    ]);
    expect(followUp[0]).toMatchObject({ role: "user" });
  });

  it("shows search activity and lists each cited source once", async () => {
    const message = (url: string) => ({
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "x", annotations: [{ type: "url_citation", url, title: "Fed holds rates" }] }],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      sseResponse([
        event({ type: "response.output_item.added", item: { type: "web_search_call" } }),
        event({ type: "response.output_text.delta", delta: "The Fed held." }),
        event({ type: "response.output_item.done", item: message("https://example.com/fed") }),
        event({ type: "response.output_item.done", item: message("https://example.com/fed") }),
        event({ type: "response.completed", response: {} }),
      ]),
    ));
    expect(await lines(ask())).toEqual([
      { s: "Searching the web" },
      { t: "The Fed held." },
      { src: [{ url: "https://example.com/fed", title: "Fed holds rates" }] },
      { done: true },
    ]);
  });

  it("retries without web search when the subscription rejects it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Unsupported tool type: web_search" } }), { status: 400 }))
      .mockResolvedValueOnce(sseResponse([event({ type: "response.output_text.delta", delta: "ok" })]));
    vi.stubGlobal("fetch", fetchMock);
    const out = await collectText(ask("grok"));
    expect(out).toMatchObject({ text: "ok", error: null });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).tools.map((t: { type: string; name?: string }) => t.name ?? t.type)).toEqual(["get_quotes"]);
  });

  it("makes the model answer once it has used its tool rounds", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(sseResponse([event({ type: "response.output_item.done", item: quoteCall }), event({ type: "response.completed", response: {} })])),
    );
    vi.stubGlobal("fetch", fetchMock);
    tools.prepareTool.mockReturnValue({ status: "Getting quotes for NVDA", run: () => Promise.resolve("NVDA: $110.00") });
    const out = await lines(ask());
    expect(fetchMock).toHaveBeenCalledTimes(6);
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(bodies.slice(0, 5).every((b) => b.tool_choice === undefined)).toBe(true);
    expect(bodies[5].tool_choice).toBe("none");
    expect(tools.prepareTool).toHaveBeenCalledTimes(5);
    expect(out.at(-1)).toEqual({ done: true });
  });

  it("stops at the first upstream error after a tool round", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sseResponse([event({ type: "response.output_item.done", item: quoteCall }), event({ type: "response.completed", response: {} })]))
      .mockResolvedValueOnce(new Response("", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    tools.prepareTool.mockReturnValue({ status: "Getting quotes for NVDA", run: () => Promise.resolve("x") });
    const out = await lines(ask());
    expect(out.at(-1)).toEqual({ e: "Your subscription's rate limit was hit. Try again shortly." });
    expect(out.some((l) => l.done)).toBe(false);
  });

  it("starts a new paragraph when text resumes after a tool call", async () => {
    vi.stubGlobal("fetch", vi
      .fn()
      .mockResolvedValueOnce(sseResponse([
        event({ type: "response.output_text.delta", delta: "Checking." }),
        event({ type: "response.output_item.done", item: quoteCall }),
        event({ type: "response.completed", response: {} }),
      ]))
      .mockResolvedValueOnce(sseResponse([event({ type: "response.output_text.delta", delta: "NVDA " }), event({ type: "response.output_text.delta", delta: "is up." })])));
    tools.prepareTool.mockReturnValue({ status: "Getting quotes for NVDA", run: () => Promise.resolve("x") });
    expect(await lines(ask())).toEqual([{ t: "Checking." }, { s: "Getting quotes for NVDA" }, { t: "\n\nNVDA " }, { t: "is up." }, { done: true }]);
  });

  it("refuses tool calls beyond the answer's budget, and ones it cannot answer", async () => {
    const call = (id: string) => ({ ...quoteCall, call_id: id });
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(sseResponse([
        ...["a", "b", "c", "d"].map((id) => event({ type: "response.output_item.done", item: call(id) })),
        event({ type: "response.output_item.done", item: { type: "function_call", name: "get_quotes", arguments: "{}" } }),
        event({ type: "response.completed", response: {} }),
      ])),
    );
    vi.stubGlobal("fetch", fetchMock);
    tools.prepareTool.mockReturnValue({ status: "Getting quotes", run: () => Promise.resolve("ok") });
    await lines(ask());
    expect(tools.prepareTool).toHaveBeenCalledTimes(10);
    const lastInput: { type?: string; call_id?: string; output?: string }[] = JSON.parse(fetchMock.mock.calls[5][1].body).input;
    expect(lastInput.filter((i) => i.type === "function_call_output" && /budget/.test(i.output ?? ""))).toHaveLength(10);
    // The call without an id can't be answered, so it is never sent back.
    expect(lastInput.filter((i) => i.type === "function_call").every((i) => typeof i.call_id === "string")).toBe(true);
  });

  it("finishes as soon as the response completes, even if the connection lingers", async () => {
    const lingering = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(event({ type: "response.output_text.delta", delta: "Done." }) + event({ type: "response.completed", response: {} })));
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(lingering)));
    expect(await lines(ask())).toEqual([{ t: "Done." }, { done: true }]);
  });

  it("keeps a source's title when the same page is listed again without one", async () => {
    const message = { type: "message", role: "assistant", content: [{ type: "output_text", text: "x", annotations: [{ type: "url_citation", url: "https://example.com/a", title: "Titled" }] }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      sseResponse([event({ type: "response.output_item.done", item: message }), event({ type: "response.completed", response: { citations: ["https://example.com/a", "https://example.com/b"] } })]),
    ));
    expect((await lines(ask("grok"))).find((l) => l.src)).toEqual({
      src: [{ url: "https://example.com/a", title: "Titled" }, { url: "https://example.com/b", title: null }],
    });
  });
});
