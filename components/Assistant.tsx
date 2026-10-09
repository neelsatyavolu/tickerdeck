"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ProposalCard } from "./dashboard/ProposalCard";
import { extractProposals, PANEL_FENCE } from "@/lib/dashboard/aiPanels";

type Provider = "codex" | "grok";
type Msg = { role: "user" | "assistant"; content: string };
type Focus = { portfolioId?: string; symbol?: string; dashboardId?: string };
type Status = Record<Provider, boolean>;
type Models = Record<Provider, { id: string; label: string }[]>;

const PROVIDER_LABEL: Record<Provider, string> = { codex: "ChatGPT", grok: "Grok" };
const PREF_KEY = "tickerdeck.ai";

type Ctx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  ask: (text: string, focus?: Focus) => void;
  status: Status | null;
  refreshStatus: () => Promise<void>;
};

const AssistantCtx = createContext<Ctx | null>(null);

export function useAssistant(): Ctx {
  const ctx = useContext(AssistantCtx);
  if (!ctx) throw new Error("useAssistant must be used inside AssistantProvider");
  return ctx;
}

function focusFromPath(path: string): Focus {
  const p = path.match(/^\/p\/([0-9a-f-]{36})/);
  if (p) return { portfolioId: p[1] };
  const d = path.match(/^\/d\/([0-9a-f-]{36})/);
  if (d) return { dashboardId: d[1] };
  const s = path.match(/^\/s\/((?:%5E|\^)?[A-Za-z0-9.-]{1,10})/i);
  if (s) return { symbol: decodeURIComponent(s[1]).toUpperCase() };
  return {};
}

function readPrefs(): { provider?: Provider; model?: Partial<Record<Provider, string>> } {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writePrefs(v: { provider: Provider; model: Partial<Record<Provider, string>> }) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

async function loadStatus(): Promise<{ status: Status; models: Models | null }> {
  try {
    const [status, models] = await Promise.all([
      fetch("/api/ai/status").then((r) => r.json() as Promise<Status>),
      fetch("/api/ai/models").then((r) => r.json() as Promise<Models>),
    ]);
    return { status, models };
  } catch {
    return { status: { codex: false, grok: false }, models: null };
  }
}

// Images are dropped: model output can echo text from third-party headlines, and
// an image URL would load automatically and could carry data off the page.
const MD_COMPONENTS = {
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
  ),
};

/** An assistant reply: prose, plus any proposed dashboard panels as action cards. */
function Reply({ text, dashboardId }: { text: string; dashboardId?: string }) {
  // While streaming, hide a panel block until its closing fence arrives.
  const open = text.lastIndexOf("```" + PANEL_FENCE);
  const complete = open === -1 || text.indexOf("```", open + 3 + PANEL_FENCE.length) !== -1;
  const { prose, proposals } = extractProposals(complete ? text : text.slice(0, open));
  return (
    <>
      {prose && <Markdown text={prose} />}
      {proposals.map((p, i) => <ProposalCard key={i} proposal={p} defaultDashboardId={dashboardId} />)}
      {!complete && <div className="notice">Drafting panels<span className="caret" aria-hidden="true" /></div>}
    </>
  );
}

function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} disallowedElements={["img"]} unwrapDisallowed components={MD_COMPONENTS}>
      {text}
    </ReactMarkdown>
  );
}

/** Reads the NDJSON stream from /api/ai/chat, calling onText for each chunk. */
async function streamAnswer(body: object, onText: (t: string) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.headers.get("content-type")?.includes("ndjson") || !res.body) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error ?? `The assistant failed (HTTP ${res.status}).`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line) as { t?: string; e?: string };
      if (msg.t) onText(msg.t);
      if (msg.e) throw new Error(msg.e);
    }
  }
}

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [models, setModels] = useState<Models | null>(null);
  const [provider, setProvider] = useState<Provider>("codex");
  const [modelPref, setModelPref] = useState<Partial<Record<Provider, string>>>({});
  const abort = useRef<AbortController | null>(null);
  const pathname = usePathname();

  const applyStatus = useCallback((loaded: { status: Status; models: Models | null }) => {
    const s = loaded.status;
    setStatus(s);
    setModels(loaded.models);
    const prefs = readPrefs();
    setProvider(prefs.provider && s[prefs.provider] ? prefs.provider : s.codex ? "codex" : s.grok ? "grok" : prefs.provider ?? "codex");
    setModelPref(prefs.model ?? {});
  }, []);

  const refreshStatus = useCallback(async () => applyStatus(await loadStatus()), [applyStatus]);

  useEffect(() => {
    let cancelled = false;
    loadStatus().then((loaded) => !cancelled && applyStatus(loaded));
    return () => {
      cancelled = true;
    };
  }, [applyStatus]);

  const send = useCallback(
    async (history: Msg[], focus: Focus) => {
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      setBusy(true);
      setError(null);
      setMessages([...history, { role: "assistant", content: "" }]);
      try {
        await streamAnswer(
          { provider, model: modelPref[provider], messages: history, focus },
          (t) =>
            setMessages((prev) => {
              const next = prev.slice();
              const last = next[next.length - 1];
              next[next.length - 1] = { ...last, content: last.content + t };
              return next;
            }),
          ctrl.signal,
        );
      } catch (err) {
        // Drop an empty assistant turn so it isn't shown or sent upstream next time.
        setMessages((prev) => (prev[prev.length - 1]?.content ? prev : prev.slice(0, -1)));
        if (ctrl.signal.aborted) return;
        setError(err instanceof Error ? err.message : "The assistant failed.");
      } finally {
        if (abort.current === ctrl) setBusy(false);
      }
    },
    [provider, modelPref],
  );

  const ask = useCallback(
    (text: string, focus?: Focus) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setOpen(true);
      const history: Msg[] = [...messages, { role: "user", content: trimmed }];
      send(history.slice(-40), focus ?? focusFromPath(pathname));
    },
    [messages, pathname, send],
  );

  const stop = () => {
    abort.current?.abort();
    setBusy(false);
    setMessages((prev) => (prev.length && !prev[prev.length - 1].content ? prev.slice(0, -1) : prev));
  };

  const chooseProvider = (p: Provider) => {
    setProvider(p);
    writePrefs({ provider: p, model: modelPref });
  };
  const chooseModel = (id: string) => {
    const next = { ...modelPref, [provider]: id };
    setModelPref(next);
    writePrefs({ provider, model: next });
  };

  const value = useMemo(() => ({ open, setOpen, ask, status, refreshStatus }), [open, ask, status, refreshStatus]);
  const connected = status ? (Object.keys(status) as Provider[]).filter((p) => status[p]) : [];
  const focus = focusFromPath(pathname);

  // Escape closes the sheet.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <AssistantCtx.Provider value={value}>
      {children}
      {!open && (
        <button className="btn btn-primary sheet-launcher" onClick={() => setOpen(true)} aria-haspopup="dialog">
          Ask AI{focus.symbol ? ` about ${focus.symbol}` : focus.portfolioId ? " about this portfolio" : focus.dashboardId ? " about this dashboard" : ""}
        </button>
      )}
      <aside className="sheet" data-open={open} role="dialog" aria-label="AI assistant" aria-hidden={!open}>
        <div className="sheet-head">
          <span className="label" style={{ color: "var(--fg)" }}>Assistant</span>
          {connected.length > 0 && (
            <>
              <select className="input" style={{ padding: "4px 6px", fontSize: 12 }} value={provider} onChange={(e) => chooseProvider(e.target.value as Provider)} aria-label="Provider">
                {connected.map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}
              </select>
              {models && (
                <select className="input" style={{ padding: "4px 6px", fontSize: 12, maxWidth: 140 }} value={modelPref[provider] ?? ""} onChange={(e) => chooseModel(e.target.value)} aria-label="Model">
                  <option value="">Default model</option>
                  {models[provider].map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              )}
            </>
          )}
          <span style={{ flex: 1 }} />
          {messages.length > 0 && <button className="btn-text" onClick={() => { stop(); setMessages([]); setError(null); }}>Clear</button>}
          <button className="btn-text" onClick={() => setOpen(false)} aria-label="Close assistant">Close</button>
        </div>
        <div className="sheet-body">
          {status && connected.length === 0 ? (
            <div className="empty">
              <p>Connect your ChatGPT or Grok subscription to ask questions about your portfolios.</p>
              <Link className="btn btn-primary" href="/settings" onClick={() => setOpen(false)}>Open settings</Link>
            </div>
          ) : messages.length === 0 ? (
            <div className="stack">
              <p className="serif muted" style={{ fontSize: 17, margin: 0 }}>
                Ask about your portfolios, a ticker, or the forecasts. It sees your holdings, live prices, analyst data and recent news{focus.symbol ? `, focused on ${focus.symbol}` : focus.portfolioId ? ", focused on this portfolio" : ""}.
              </p>
              {["How is my portfolio doing today, and what's driving it?", "Which position is most concentrated or riskiest?", focus.dashboardId ? "Add panels comparing my holdings with the S&P 500 and showing today's movers." : focus.symbol ? `Bull, base and bear case for $${focus.symbol}?` : "Summarise recent news for my holdings."].map((s) => (
                <button key={s} className="btn btn-ghost" style={{ justifyContent: "flex-start", textAlign: "left" }} onClick={() => ask(s)}>{s}</button>
              ))}
            </div>
          ) : (
            messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="msg-user">{m.content}</div>
              ) : (
                <div key={i} className="prose">
                  {m.content ? <Reply text={m.content} dashboardId={focus.dashboardId} /> : <span className="caret" aria-label="Thinking" />}
                </div>
              ),
            )
          )}
          {error && (
            <div className="error" role="alert">
              {error} {/Reconnect|Connect/.test(error) && <Link href="/settings" style={{ textDecoration: "underline" }} onClick={() => setOpen(false)}>Settings</Link>}
            </div>
          )}
        </div>
        {connected.length > 0 && <Composer busy={busy} onSend={(t) => ask(t)} onStop={stop} />}
      </aside>
    </AssistantCtx.Provider>
  );
}

function Composer({ busy, onSend, onStop }: { busy: boolean; onSend: (t: string) => void; onStop: () => void }) {
  const [text, setText] = useState("");
  const submit = () => {
    if (!text.trim() || busy) return;
    onSend(text);
    setText("");
  };
  return (
    <form className="sheet-foot" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <textarea
        className="input"
        value={text}
        placeholder="Ask about a holding, $TICKER, or a forecast"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        aria-label="Message"
      />
      <div className="spread">
        <span className="notice">Not financial advice. Answers use your subscription.</span>
        {busy ? <button type="button" className="btn btn-ghost" onClick={onStop}>Stop</button> : <button className="btn btn-primary" disabled={!text.trim()}>Send</button>}
      </div>
    </form>
  );
}
