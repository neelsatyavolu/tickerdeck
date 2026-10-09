// Incremental Server-Sent Events parsing for the two upstream formats:
// ChatGPT's Codex "responses" stream and OpenAI-style chat completion chunks (Grok).

export type TextEvent = { text?: string; error?: string; done?: boolean; tier?: string };

/** Splits a byte stream into SSE `data:` payloads, tolerating chunk boundaries anywhere. */
export function createSseSplitter(onData: (data: string) => void) {
  let buffer = "";
  return {
    push(chunk: string) {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.search(/\r?\n/)) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + (buffer[idx] === "\r" ? 2 : 1));
        if (line.startsWith("data:")) onData(line.slice(5).trim());
      }
    },
    flush() {
      if (buffer.startsWith("data:")) onData(buffer.slice(5).trim());
      buffer = "";
    },
  };
}

type CodexEvent = {
  type?: string;
  delta?: unknown;
  error?: { message?: string };
  response?: { error?: { message?: string } | null; service_tier?: string };
  message?: string;
};

export function codexEvent(data: string): TextEvent | null {
  if (!data || data === "[DONE]") return data === "[DONE]" ? { done: true } : null;
  let e: CodexEvent;
  try {
    e = JSON.parse(data);
  } catch {
    return null;
  }
  if (e.type === "response.output_text.delta" && typeof e.delta === "string") return { text: e.delta };
  if (e.type === "response.completed") return typeof e.response?.service_tier === "string" ? { done: true, tier: e.response.service_tier } : { done: true };
  const error = e.error?.message ?? e.response?.error?.message ?? (e.type === "error" ? e.message : undefined);
  if (error || e.type === "response.failed") return { error: error ?? "The model request failed." };
  return null;
}

type ChatChunk = { choices?: { delta?: { content?: unknown }; finish_reason?: string | null }[]; error?: { message?: string } };

export function chatEvent(data: string): TextEvent | null {
  if (!data) return null;
  if (data === "[DONE]") return { done: true };
  let c: ChatChunk;
  try {
    c = JSON.parse(data);
  } catch {
    return null;
  }
  if (c.error?.message) return { error: c.error.message };
  const content = c.choices?.[0]?.delta?.content;
  return typeof content === "string" && content ? { text: content } : null;
}
