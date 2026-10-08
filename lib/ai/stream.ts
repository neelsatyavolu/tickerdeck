import "server-only";
import { chatEvent, codexEvent, createSseSplitter, type TextEvent } from "./sse";
import type { Provider, Tokens } from "./providers";

// Streams a completion from the user's own subscription as NDJSON lines:
// {"t":"text chunk"} … then {"done":true} or {"e":"error message"}.

const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const GROK_CHAT_URL = "https://api.x.ai/v1/chat/completions";
const IDLE_TIMEOUT_MS = 90_000;

export type ChatMessage = { role: "user" | "assistant"; content: string };

type StreamParams = { provider: Provider; tokens: Tokens; model: string; system: string; messages: ChatMessage[] };

function codexRequest({ tokens, model, system, messages }: StreamParams): [string, RequestInit] {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${tokens.accessToken}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    originator: "codex_cli_rs",
    "OpenAI-Beta": "responses=v1",
  };
  if (tokens.accountId) headers["chatgpt-account-id"] = tokens.accountId;
  const body = {
    model,
    instructions: system,
    input: messages.map((m) => ({
      role: m.role,
      content: [{ type: m.role === "assistant" ? "output_text" : "input_text", text: m.content }],
    })),
    reasoning: { effort: "low" },
    store: false,
    stream: true,
  };
  return [CODEX_RESPONSES_URL, { method: "POST", headers, body: JSON.stringify(body) }];
}

function grokRequest({ tokens, model, system, messages }: StreamParams): [string, RequestInit] {
  const body = {
    model,
    messages: [{ role: "system", content: system }, ...messages],
    temperature: 0.4,
    stream: true,
  };
  return [
    GROK_CHAT_URL,
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

async function upstreamError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
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

export function streamChat(params: StreamParams): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const parse = params.provider === "codex" ? codexEvent : chatEvent;
  const [url, init] = params.provider === "codex" ? codexRequest(params) : grokRequest(params);
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
      let finished = false;
      const handle = (event: TextEvent | null) => {
        if (!event || finished) return;
        if (event.text) send({ t: event.text });
        if (event.error) {
          finished = true;
          send({ e: event.error });
        } else if (event.done) {
          finished = true;
          send({ done: true });
        }
      };

      armIdle();
      try {
        const res = await fetch(url, { ...init, signal: upstream.signal });
        if (!res.ok || !res.body) {
          handle({ error: await upstreamError(res) });
        } else {
          const splitter = createSseSplitter((data) => handle(parse(data)));
          const decoder = new TextDecoder();
          reader = res.body.getReader();
          for (;;) {
            const { value, done } = await reader.read();
            if (done || closed) break;
            armIdle();
            splitter.push(decoder.decode(value, { stream: true }));
          }
          splitter.flush();
          handle({ done: true });
        }
      } catch (err) {
        if (!closed) {
          console.error(`[ai] ${params.provider} stream failed`, err instanceof Error ? err.message : err);
          handle({ error: timedOut ? "The model stopped responding." : "Could not reach the model." });
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
export async function collectText(stream: ReadableStream<Uint8Array>): Promise<{ text: string; error: string | null }> {
  const raw = await new Response(stream).text();
  let text = "";
  let error: string | null = null;
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const msg = JSON.parse(line) as { t?: string; e?: string };
    if (msg.t) text += msg.t;
    if (msg.e) error = msg.e;
  }
  return { text, error };
}
