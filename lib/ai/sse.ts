// Incremental Server-Sent Events parsing for the "responses" stream that both
// ChatGPT's Codex backend and xAI (Grok) speak.

/** A web page the model cited. */
export type Source = { url: string; title: string | null };

/** Something the model produced besides text: a function call, a search it ran, its reasoning. */
export type OutputItem = Record<string, unknown> & { type: string };

export type StreamEvent = {
  text?: string;
  error?: string;
  done?: boolean;
  tier?: string;
  /** What the model is doing right now, e.g. "Searching the web". */
  status?: string;
  item?: OutputItem;
  sources?: Source[];
};

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

type RawEvent = {
  type?: string;
  delta?: unknown;
  item?: unknown;
  error?: { message?: string };
  response?: { error?: { message?: string } | null; service_tier?: string; citations?: unknown };
  message?: string;
};

const MAX_TITLE_CHARS = 200;
const SEARCH_STATUS: Record<string, string> = { web_search_call: "Searching the web", x_search_call: "Searching X" };

function isItem(value: unknown): value is OutputItem {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function source(url: unknown, title?: unknown): Source | null {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return null;
  return { url, title: typeof title === "string" && title ? title.slice(0, MAX_TITLE_CHARS) : null };
}

/** Links the model cited in a finished message. */
function citations(item: OutputItem): Source[] {
  const parts = Array.isArray(item.content) ? (item.content as { annotations?: unknown }[]) : [];
  return parts
    .flatMap((part) => (Array.isArray(part?.annotations) ? (part.annotations as { type?: string; url?: unknown; title?: unknown }[]) : []))
    .filter((a) => a?.type === "url_citation")
    .map((a) => source(a.url, a.title))
    .filter((s): s is Source => s !== null);
}

/** The item as it should be sent back next round: stored ids mean nothing when nothing is stored. */
function withoutId(item: OutputItem): OutputItem {
  return Object.fromEntries(Object.entries(item).filter(([key]) => key !== "id")) as OutputItem;
}

export function responsesEvent(data: string): StreamEvent | null {
  if (!data || data === "[DONE]") return data === "[DONE]" ? { done: true } : null;
  let e: RawEvent;
  try {
    e = JSON.parse(data);
  } catch {
    return null;
  }
  if (e.type === "response.output_text.delta" && typeof e.delta === "string") return { text: e.delta };
  if (e.type === "response.output_item.added" && isItem(e.item)) {
    const status = SEARCH_STATUS[e.item.type];
    return status ? { status } : null;
  }
  if (e.type === "response.output_item.done" && isItem(e.item)) {
    const sources = citations(e.item);
    return { item: withoutId(e.item), ...(sources.length ? { sources } : {}) };
  }
  if (e.type === "response.completed") {
    // Grok lists what it read as plain URLs on the finished response.
    const listed = Array.isArray(e.response?.citations) ? e.response.citations.map((u) => source(u)).filter((s): s is Source => s !== null) : [];
    return {
      done: true,
      ...(typeof e.response?.service_tier === "string" ? { tier: e.response.service_tier } : {}),
      ...(listed.length ? { sources: listed } : {}),
    };
  }
  const error = e.error?.message ?? e.response?.error?.message ?? (e.type === "error" ? e.message : undefined);
  if (error || e.type === "response.failed") return { error: error ?? "The model request failed." };
  return null;
}
