import "server-only";
import { effortFor, type Effort } from "./options";
import { createSseSplitter, responsesEvent, type OutputItem, type Source } from "./sse";
import { prepareTool, TOOL_SPECS } from "./tools";
import type { Provider, Tokens } from "./providers";

// Streams an answer from the user's own subscription as NDJSON lines:
// {"t":"text chunk"} … then {"done":true} or {"e":"error message"}. Along the way:
// {"s":"status"} while the model searches or reads data, {"src":[…]} for the web
// pages it cited, and {"tier":"priority"|"default"} for ChatGPT so the UI knows
// whether Fast mode applied.
//
// The model can call the data tools in lib/ai/tools.ts and its provider's
// built-in web search. A tool call ends the response; we run the tool and ask
// again with the result, for at most MAX_ROUNDS requests per answer.

const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const GROK_RESPONSES_URL = "https://api.x.ai/v1/responses";
const IDLE_TIMEOUT_MS = 90_000;
const MAX_ROUNDS = 6;
// Per answer, so one question can't flood the market-data APIs.
const MAX_TOOL_CALLS = 10;
const TOOL_CONCURRENCY = 3;
const OVER_BUDGET = "Error: the tool budget for this answer is used up. Answer with what you have.";
const MAX_SOURCES = 12;

// Search that runs on the provider's side and counts against the subscription.
const HOSTED_SEARCH: Record<Provider, object[]> = {
  codex: [{ type: "web_search", external_web_access: true }],
  grok: [{ type: "web_search" }, { type: "x_search" }],
};

export type ChatMessage = { role: "user" | "assistant"; content: string };

type StreamParams = {
  provider: Provider;
  tokens: Tokens;
  model: string;
  system: string;
  messages: ChatMessage[];
  effort?: Effort;
  /** ChatGPT Fast mode: priority processing (uses more of the plan's credits). */
  fast?: boolean;
};

/** What a single attempt sends; the retry loop drops options the backend rejects. */
type Attempt = { effort: Effort | null; fast: boolean; search: boolean };

/** One request to the model. On the final round it must answer instead of calling another tool. */
type Round = { input: object[]; final: boolean };

type FunctionCall = OutputItem & { type: "function_call"; call_id: string; name: string };

/** How the request loop talks to the browser stream that owns it. */
type Io = {
  send: (line: object) => void;
  signal: AbortSignal;
  /** Restart the silence timer. */
  alive: () => void;
  closed: () => boolean;
  reading: (reader: ReadableStreamDefaultReader<Uint8Array>) => void;
};

function firstInput({ provider, system, messages }: StreamParams): object[] {
  if (provider === "grok") return [{ role: "system", content: system }, ...messages];
  return messages.map((m) => ({
    role: m.role,
    content: [{ type: m.role === "assistant" ? "output_text" : "input_text", text: m.content }],
  }));
}

function sharedBody({ provider, model }: StreamParams, attempt: Attempt, round: Round) {
  return {
    model,
    input: round.input,
    tools: [...(attempt.search ? HOSTED_SEARCH[provider] : []), ...TOOL_SPECS],
    ...(round.final ? { tool_choice: "none" } : {}),
    // Nothing is stored upstream, so the model's reasoning travels with the conversation between rounds.
    include: ["reasoning.encrypted_content"],
    store: false,
    stream: true,
  };
}

function codexRequest(params: StreamParams, attempt: Attempt, round: Round): [string, RequestInit] {
  const { tokens, system } = params;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${tokens.accessToken}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    originator: "codex_cli_rs",
    "OpenAI-Beta": "responses=v1",
  };
  if (tokens.accountId) headers["chatgpt-account-id"] = tokens.accountId;
  const body = {
    ...sharedBody(params, attempt, round),
    instructions: system,
    ...(attempt.effort ? { reasoning: { effort: attempt.effort } } : {}),
    // The ChatGPT backend takes "priority" for Fast mode (it rejects the literal "fast").
    ...(attempt.fast ? { service_tier: "priority" } : {}),
  };
  return [CODEX_RESPONSES_URL, { method: "POST", headers, body: JSON.stringify(body) }];
}

function grokRequest(params: StreamParams, attempt: Attempt, round: Round): [string, RequestInit] {
  const { tokens, model } = params;
  const body = {
    ...sharedBody(params, attempt, round),
    temperature: 0.4,
    // Grok 4.x reasoning models take an effort; others ignore or reject it.
    ...(attempt.effort && /^grok-4/.test(model) ? { reasoning: { effort: attempt.effort } } : {}),
  };
  return [
    GROK_RESPONSES_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "User-Agent": "grok-cli/1.0",
      },
      body: JSON.stringify(body),
    },
  ];
}

function upstreamError(res: Response, text: string): string {
  try {
    const json = JSON.parse(text);
    const message = json?.error?.message ?? json?.detail ?? json?.message;
    if (typeof message === "string" && message) return message;
  } catch {
    /* not JSON */
  }
  if (res.status === 401 || res.status === 403) return "Your AI connection expired. Reconnect it in Settings.";
  if (res.status === 429) return "Your subscription's rate limit was hit. Try again shortly.";
  return `The model request failed (HTTP ${res.status}).`;
}

/**
 * Sends one request with everything the user asked for. If the backend rejects
 * Fast mode, the effort level or web search for this model/plan, drops that
 * option and tries again.
 */
async function openRound(
  params: StreamParams,
  round: Round,
  first: Attempt,
  io: Io,
): Promise<{ body: ReadableStream<Uint8Array>; attempt: Attempt } | { error: string }> {
  const build = params.provider === "codex" ? codexRequest : grokRequest;
  let attempt = first;
  let failure = "The model request failed.";
  for (let tries = 0; tries < 4; tries++) {
    const [url, init] = build(params, attempt, round);
    const res = await fetch(url, { ...init, signal: io.signal });
    if (res.ok && res.body) return { body: res.body, attempt };
    const text = await res.text().catch(() => "");
    failure = upstreamError(res, text);
    if (res.status !== 400) break;
    if (attempt.fast && /service.?tier|priority|fast/i.test(text)) {
      attempt = { ...attempt, fast: false };
      io.send({ tier: "default" });
    } else if (attempt.effort && /effort|reasoning/i.test(text)) {
      attempt = { ...attempt, effort: null };
    } else if (attempt.search && /search|tool/i.test(text)) {
      attempt = { ...attempt, search: false };
    } else break;
  }
  return { error: failure };
}

/** Sends the answer's text, starting a new paragraph when a search or tool call came between two stretches of it. */
function textRelay(io: Io) {
  let spoken = false;
  let interrupted = false;
  return {
    text(t: string) {
      io.send({ t: interrupted ? `\n\n${t}` : t });
      spoken = true;
      interrupted = false;
    },
    interrupt() {
      interrupted = spoken;
    },
  };
}

type RoundResult = { items: OutputItem[]; sources: Source[]; error: string | null; ended: boolean };

/** Relays one response to the browser as it arrives, and returns what else the model produced. */
async function readRound(body: ReadableStream<Uint8Array>, relay: ReturnType<typeof textRelay>, io: Io): Promise<RoundResult> {
  let result: RoundResult = { items: [], sources: [], error: null, ended: false };
  const splitter = createSseSplitter((data) => {
    const event = responsesEvent(data);
    if (!event || result.ended) return;
    if (event.text) relay.text(event.text);
    if (event.tier) io.send({ tier: event.tier });
    if (event.status) io.send({ s: event.status });
    if (event.status || event.item) relay.interrupt();
    result = {
      items: event.item ? [...result.items, event.item] : result.items,
      sources: event.sources ? [...result.sources, ...event.sources] : result.sources,
      error: event.error ?? null,
      ended: Boolean(event.error || event.done),
    };
  });
  const decoder = new TextDecoder();
  const reader = body.getReader();
  io.reading(reader);
  for (;;) {
    const { value, done } = await reader.read();
    if (done || io.closed()) break;
    io.alive();
    splitter.push(decoder.decode(value, { stream: true }));
    // The response is complete; don't wait for the provider to hang up.
    if (result.ended) {
      reader.cancel().catch(() => {});
      break;
    }
  }
  splitter.flush();
  return result;
}

function isFunctionCall(item: OutputItem): item is FunctionCall {
  return item.type === "function_call" && typeof item.call_id === "string" && typeof item.name === "string";
}

/**
 * Runs the tools the model asked for, a few at a time; their results are the
 * next round's new input. Calls beyond the budget are refused, not run.
 */
async function runCalls(calls: FunctionCall[], budget: number, io: Io): Promise<object[]> {
  const run = async (call: FunctionCall, index: number) => {
    if (index >= budget) return { type: "function_call_output", call_id: call.call_id, output: OVER_BUDGET };
    const tool = prepareTool(call.name, typeof call.arguments === "string" ? call.arguments : "");
    io.send({ s: tool.status });
    return { type: "function_call_output", call_id: call.call_id, output: await tool.run() };
  };
  let outputs: object[] = [];
  for (let i = 0; i < calls.length; i += TOOL_CONCURRENCY) {
    outputs = [...outputs, ...(await Promise.all(calls.slice(i, i + TOOL_CONCURRENCY).map((call, j) => run(call, i + j))))];
    io.alive();
  }
  return outputs;
}

/** One entry per page, in the order first seen, preferring an entry that has a title. */
function uniqueSources(sources: Source[]): Source[] {
  const byUrl = new Map<string, Source>();
  for (const s of sources) if (!byUrl.get(s.url)?.title) byUrl.set(s.url, s);
  return [...byUrl.values()].slice(0, MAX_SOURCES);
}

/** The whole answer: ask, run any tools the model calls, ask again. Returns an error message, or null once it finished. */
async function answer(params: StreamParams, io: Io): Promise<string | null> {
  let attempt: Attempt = { effort: effortFor(params.provider, params.effort), fast: params.provider === "codex" && Boolean(params.fast), search: true };
  let input = firstInput(params);
  let sources: Source[] = [];
  let budget = MAX_TOOL_CALLS;
  const relay = textRelay(io);
  for (let n = 1; n <= MAX_ROUNDS && !io.closed(); n++) {
    const round: Round = { input, final: n === MAX_ROUNDS };
    io.alive();
    const opened = await openRound(params, round, attempt, io);
    if ("error" in opened) return opened.error;
    attempt = opened.attempt;
    const result = await readRound(opened.body, relay, io);
    if (result.error) return result.error;
    sources = [...sources, ...result.sources];
    const calls = result.items.filter(isFunctionCall);
    if (calls.length === 0 || round.final) break;
    // A call without an id can't be answered, so it isn't sent back either.
    const replay = result.items.filter((item) => item.type !== "function_call" || isFunctionCall(item));
    input = [...input, ...replay, ...(await runCalls(calls, budget, io))];
    budget = Math.max(0, budget - calls.length);
  }
  if (sources.length) io.send({ src: uniqueSources(sources) });
  return null;
}

export function streamChat(params: StreamParams): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const upstream = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let closed = false;
  let timedOut = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  // Long answers are fine as long as tokens keep arriving; only silence times out.
  const armIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      timedOut = true;
      upstream.abort();
    }, IDLE_TIMEOUT_MS);
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: object) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          closed = true;
        }
      };
      const io: Io = { send, signal: upstream.signal, alive: armIdle, closed: () => closed, reading: (r) => (reader = r) };

      try {
        const error = await answer(params, io);
        send(error ? { e: error } : { done: true });
      } catch (err) {
        if (!closed) {
          console.error(`[ai] ${params.provider} stream failed`, err instanceof Error ? err.message : err);
          send({ e: timedOut ? "The model stopped responding." : "Could not reach the model." });
        }
      } finally {
        clearTimeout(idle);
      }
      if (!closed) {
        closed = true;
        controller.close();
      }
    },
    // The browser went away (Stop, navigation): stop generating on the user's quota.
    cancel() {
      closed = true;
      clearTimeout(idle);
      upstream.abort();
      reader?.cancel().catch(() => {});
    },
  });
}

/** Collects a stream into one string (used by tests and non-streaming callers). */
export async function collectText(stream: ReadableStream<Uint8Array>): Promise<{ text: string; error: string | null; tier: string | null }> {
  const raw = await new Response(stream).text();
  let text = "";
  let error: string | null = null;
  let tier: string | null = null;
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const msg = JSON.parse(line) as { t?: string; e?: string; tier?: string };
    if (msg.t) text += msg.t;
    if (msg.e) error = msg.e;
    if (msg.tier) tier = msg.tier;
  }
  return { text, error, tier };
}
