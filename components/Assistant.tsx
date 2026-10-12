"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { ProposalCard } from "./dashboard/ProposalCard";
import { EFFORT_LABEL } from "@/lib/ai/options";
import type { Source } from "@/lib/ai/sse";
import { effortOf, updateAiPrefs, useAiPrefs, type Provider } from "@/lib/client/aiPrefs";
import { DASHBOARD_FENCE, ENHANCE_PROMPT, extractProposals, PANEL_FENCE } from "@/lib/dashboard/aiPanels";

type Msg = { role: "user" | "assistant"; content: string; sources?: Source[] };
type Focus = { portfolioId?: string; symbol?: string; dashboardId?: string };
type Status = Record<Provider, boolean>;
type Models = Record<Provider, { id: string; label: string }[]>;

const PROVIDER_LABEL: Record<Provider, string> = { codex: "ChatGPT", grok: "Grok" };

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
// Links: only http(s) or in-app paths, and external ones show their real host
// so text echoed from a headline can't disguise where a link goes.
function safeLink(href: string | undefined): { href: string; host: string | null } | null {
  if (!href) return null;
  if (href.startsWith("/") && !href.startsWith("//")) return { href, host: null };
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" ? { href: url.href, host: url.hostname.replace(/^www\./, "") } : null;
  } catch {
    return null;
  }
}

const MD_COMPONENTS = {
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
    const link = safeLink(href);
    if (!link) return <>{children}</>;
    if (!link.host) return <a href={link.href}>{children}</a>;
    return (
      <a href={link.href} target="_blank" rel="noopener noreferrer nofollow">
        {children} <span className="faint mono" style={{ fontSize: 11 }}>({link.host})</span>
      </a>
    );
  },
};

/** An assistant reply: prose, plus any proposed dashboard panels as action cards. */
function Reply({ text, dashboardId }: { text: string; dashboardId?: string }) {
  // While streaming, hide a panel block until its closing fence arrives.
  const open = Math.max(text.lastIndexOf("```" + PANEL_FENCE), text.lastIndexOf("```" + DASHBOARD_FENCE));
  const complete = open === -1 || text.indexOf("```", open + 3 + PANEL_FENCE.length) !== -1;
  const { prose, proposals } = extractProposals(complete ? text : text.slice(0, open));
  return (
    <>
      {prose && <Markdown text={prose} />}
      {proposals.map((p, i) => <ProposalCard key={i} proposal={p} defaultDashboardId={dashboardId} />)}
      {!complete && <div className="notice">Drafting dashboard changes<span className="caret" aria-hidden="true" /></div>}
    </>
  );
}

/** The web pages an answer cited, each showing its real host. */
function Sources({ items }: { items: Source[] }) {
  const links = items.flatMap((s) => {
    const link = safeLink(s.url);
    return link?.host ? [{ href: link.href, host: link.host, title: s.title }] : [];
  });
  if (links.length === 0) return null;
  return (
    <div className="assist-sources">
      <div className="label">Sources</div>
      <ol>
        {links.map((l, i) => (
          <li key={i}>
            <a href={l.href} target="_blank" rel="noopener noreferrer nofollow">{l.title ?? l.host}</a>
            {l.title && <span className="faint mono"> ({l.host})</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

const MarkdownContent = dynamic(() => import("./AssistantMarkdown"), { ssr: false });

function Markdown({ text }: { text: string }) {
  return <MarkdownContent text={text} components={MD_COMPONENTS} />;
}

type StreamHandlers = {
  onText: (t: string) => void;
  onTier: (tier: string) => void;
  /** What the assistant is doing while no text is arriving, e.g. "Searching the web". */
  onStatus: (status: string) => void;
  onSources: (sources: Source[]) => void;
};

/** Reads the NDJSON stream from /api/ai/chat, calling the handler for each line. */
async function streamAnswer(body: object, signal: AbortSignal, on: StreamHandlers): Promise<void> {
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
      const msg = JSON.parse(line) as { t?: string; e?: string; tier?: string; s?: string; src?: Source[] };
      if (msg.t) on.onText(msg.t);
      if (msg.tier) on.onTier(msg.tier);
      if (msg.s) on.onStatus(msg.s);
      if (msg.src) on.onSources(msg.src);
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
  const prefs = useAiPrefs();
  const modelPref = prefs.model;
  const abort = useRef<AbortController | null>(null);
  const pathname = usePathname();

  const applyStatus = useCallback((loaded: { status: Status; models: Models | null }) => {
    const s = loaded.status;
    setStatus(s);
    setModels(loaded.models);
  }, []);

  // The provider to use: the saved default if it's connected, else whichever is.
  const provider: Provider =
    prefs.provider && status?.[prefs.provider] ? prefs.provider : status?.codex ? "codex" : status?.grok ? "grok" : prefs.provider ?? "codex";
  const effort = effortOf(prefs, provider);
  const fast = provider === "codex" && prefs.fast;
  const [lastTier, setLastTier] = useState<string | null>(null);
  // What the assistant is doing between stretches of text (searching, reading data).
  const [activity, setActivity] = useState<string | null>(null);

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
      setLastTier(null);
      setActivity(null);
      // Only the newest request may touch the thread; a replaced one must not write into its successor's turn.
      const updateLast = (change: (last: Msg) => Msg) =>
        setMessages((prev) => (abort.current === ctrl && prev.length ? [...prev.slice(0, -1), change(prev[prev.length - 1])] : prev));
      try {
        await streamAnswer(
          { provider, model: modelPref[provider], messages: history.map(({ role, content }) => ({ role, content })), focus, effort, fast },
          ctrl.signal,
          {
            onText: (t) => {
              setActivity(null);
              updateLast((last) => ({ ...last, content: last.content + t }));
            },
            onTier: setLastTier,
            onStatus: setActivity,
            onSources: (sources) => updateLast((last) => ({ ...last, sources })),
          },
        );
      } catch (err) {
        // Stopped or replaced by a newer question: whoever aborted this request already tidied the thread.
        if (ctrl.signal.aborted) return;
        // Drop an empty assistant turn so it isn't shown or sent upstream next time.
        setMessages((prev) => (prev[prev.length - 1]?.content ? prev : prev.slice(0, -1)));
        setError(err instanceof Error ? err.message : "The assistant failed.");
      } finally {
        if (abort.current === ctrl) {
          setBusy(false);
          setActivity(null);
        }
      }
    },
    [provider, modelPref, effort, fast],
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
    setActivity(null);
    setMessages((prev) => (prev.length && !prev[prev.length - 1].content ? prev.slice(0, -1) : prev));
  };

  const chooseModelKey = (key: string) => {
    const [p, id] = key.split(":") as [Provider, string];
    updateAiPrefs((prev) => ({ ...prev, provider: p, model: { ...prev.model, [p]: id || undefined } }));
  };

  const value = useMemo(() => ({ open, setOpen, ask, status, refreshStatus }), [open, ask, status, refreshStatus]);
  const connected = status ? (Object.keys(status) as Provider[]).filter((p) => status[p]) : [];
  const focus = focusFromPath(pathname);
  const [expanded, setExpanded] = useState(false);

  // Auto-scroll: follow the conversation as it streams, unless the user has
  // scrolled up to read something (then leave them where they are).
  const body = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const onBodyScroll = () => {
    const el = body.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };
  useEffect(() => {
    // A new question always jumps to the bottom.
    if (messages[messages.length - 1]?.role === "user" || messages[messages.length - 1]?.content === "") pinned.current = true;
  }, [messages]);
  useEffect(() => {
    const el = body.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages, error, busy, activity]);
  const modelLabel = [
    models?.[provider]?.find((m) => m.id === modelPref[provider])?.label ?? `${PROVIDER_LABEL[provider]} default`,
    EFFORT_LABEL[effort].toLowerCase(),
    fast ? "fast" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // Fast mode was asked for but the backend answered at standard speed.
  const fastDeclined = fast && !busy && lastTier !== null && lastTier !== "priority";
  const suggestions = [
    focus.symbol ? `Bull, base and bear case for $${focus.symbol}?` : "How are my portfolios doing today, and what's driving it?",
    focus.dashboardId ? ENHANCE_PROMPT : "Which position is most concentrated or riskiest?",
    focus.portfolioId ? "What would a 10% market drop do to this portfolio?" : "Build me a dashboard for semiconductor stocks.",
  ];

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
        <button className="btn btn-primary assist-launcher" onClick={() => setOpen(true)} aria-haspopup="dialog">
          Ask AI{focus.symbol ? ` about ${focus.symbol}` : focus.portfolioId ? " about this portfolio" : focus.dashboardId ? " about this dashboard" : ""}
        </button>
      )}
      <aside className="assist" data-open={open} data-expanded={expanded} role="dialog" aria-label="AI assistant" aria-hidden={!open}>
        <div className="assist-head">
          <span className="assist-mark" aria-hidden="true" />
          <span className="assist-title">Assistant</span>
          {connected.length > 0 && <span className="assist-chip">{modelLabel}</span>}
          <span style={{ flex: 1 }} />
          {messages.length > 0 && <button className="btn-text" onClick={() => { stop(); setMessages([]); setError(null); }}>Clear</button>}
          <button className="btn-text" onClick={() => setExpanded((v) => !v)} aria-label={expanded ? "Shrink assistant" : "Expand assistant"} title={expanded ? "Shrink" : "Expand"}>{expanded ? "↙" : "↗"}</button>
          <button className="btn-text" onClick={() => setOpen(false)} aria-label="Close assistant" title="Close" style={{ fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        {connected.length > 0 && models && (
          <div className="assist-models">
            <select className="input" value={`${provider}:${modelPref[provider] ?? ""}`} onChange={(e) => chooseModelKey(e.target.value)} aria-label="Model">
              {connected.map((p) => (
                <optgroup key={p} label={PROVIDER_LABEL[p]}>
                  <option value={`${p}:`}>{PROVIDER_LABEL[p]} default</option>
                  {models[p].map((m) => <option key={m.id} value={`${p}:${m.id}`}>{m.label}</option>)}
                </optgroup>
              ))}
            </select>
            <span className="faint" style={{ fontSize: 13, whiteSpace: "nowrap" }}>Default: {PROVIDER_LABEL[provider]}</span>
          </div>
        )}
        <div className="assist-body" ref={body} onScroll={onBodyScroll} aria-live="polite">
          {status && connected.length === 0 ? (
            <div className="stack">
              <p className="assist-intro">Connect your ChatGPT or Grok subscription to ask about your portfolios, watchlist and dashboards.</p>
              <div><Link className="btn btn-primary" href="/settings" onClick={() => setOpen(false)}>Open settings</Link></div>
            </div>
          ) : messages.length === 0 ? (
            <div className="stack">
              <p className="assist-intro">
                I can see your <em>portfolios</em>, <em>watchlist</em>, <em>dashboards</em>, live prices, analyst data and recent news{focus.symbol ? `, focused on ${focus.symbol}` : focus.portfolioId ? ", focused on this portfolio" : focus.dashboardId ? ", focused on this dashboard" : ""}. I can also look up any ticker and <em>search the web</em>. Ask about performance, risk, forecasts, or ask me to build dashboard panels.
              </p>
              <div className="assist-try">
                <div className="label" style={{ color: "var(--fg)" }}>Try</div>
                {suggestions.map((q) => (
                  <button key={q} className="assist-suggestion" onClick={() => ask(q)}>“{q}”</button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="msg-user">{m.content}</div>
              ) : (
                <div key={i} className="prose">
                  {m.content ? <Reply text={m.content} dashboardId={focus.dashboardId} /> : !activity && <span className="caret" aria-label="Thinking" />}
                  {busy && activity && i === messages.length - 1 && <div className="notice">{activity}<span className="caret" aria-hidden="true" /></div>}
                  {m.sources && <Sources items={m.sources} />}
                </div>
              ),
            )
          )}
          {fastDeclined && messages.length > 0 && (
            <div className="notice">Fast mode wasn&apos;t available for this answer; it ran at standard speed.</div>
          )}
          {error && (
            <div className="error" role="alert">
              {error} {/Reconnect|Connect/.test(error) && <Link href="/settings" style={{ textDecoration: "underline" }} onClick={() => setOpen(false)}>Settings</Link>}
            </div>
          )}
        </div>
        {connected.length > 0 && <Composer busy={busy} onSend={(t) => ask(t)} onStop={stop} open={open} />}
      </aside>
    </AssistantCtx.Provider>
  );
}

function Composer({ busy, onSend, onStop, open }: { busy: boolean; onSend: (t: string) => void; onStop: () => void; open: boolean }) {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  const submit = () => {
    if (!text.trim() || busy) return;
    onSend(text);
    setText("");
  };
  return (
    <form className="assist-foot" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <input ref={input} className="input" value={text} placeholder="Ask anything about your stocks…" onChange={(e) => setText(e.target.value)} aria-label="Message" title="Not financial advice. Answers use your subscription." />
      {busy ? <button type="button" className="btn btn-ghost" onClick={onStop}>Stop</button> : <button className="btn btn-primary" disabled={!text.trim()}>Send</button>}
    </form>
  );
}
