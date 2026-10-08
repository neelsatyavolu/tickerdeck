"use client";

import { useEffect, useState } from "react";
import { useAssistant } from "@/components/Assistant";
import { ErrorText } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";

type Provider = "codex" | "grok";

const INFO: Record<Provider, { name: string; plan: string; paste: string }> = {
  codex: {
    name: "ChatGPT",
    plan: "Uses your ChatGPT Plus or Pro subscription through the Codex sign-in.",
    paste: "After you approve, the tab lands on a localhost page that won't load. Copy the full address from that tab's address bar and paste it here.",
  },
  grok: {
    name: "Grok",
    plan: "Uses your SuperGrok or X Premium subscription through the Grok CLI sign-in.",
    paste: "After you approve, copy the code xAI shows (or the full address of the page it redirects to) and paste it here.",
  },
};

async function post(url: string, body?: object): Promise<{ ok?: boolean; error?: string; authorizeUrl?: string }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status}).`);
  return json;
}

function Connection({ provider, connected, onChange }: { provider: Provider; connected: boolean; onChange: () => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const info = INFO[provider];

  const start = async () => {
    setError(null);
    // Open the tab synchronously so popup blockers allow it, then point it at the sign-in URL.
    const tab = window.open("about:blank", "_blank");
    try {
      const { authorizeUrl } = await post(`/api/ai/${provider}/start`);
      if (!authorizeUrl) throw new Error("No sign-in URL returned.");
      if (tab) tab.location.href = authorizeUrl;
      else window.location.href = authorizeUrl;
      setPending(true);
    } catch (err) {
      tab?.close();
      setError(err instanceof Error ? err.message : "Could not start sign-in.");
    }
  };

  const complete = async () => {
    setBusy(true);
    setError(null);
    try {
      await post(`/api/ai/${provider}/complete`, { callback: pasted.trim() });
      setPending(false);
      setPasted("");
      await onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await post(`/api/ai/${provider}/logout`);
      await onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="spread">
        <div className="label" style={{ color: "var(--fg)" }}>{info.name}</div>
        <span className="status"><span className={`dot ${connected ? "ok" : ""}`} />{connected ? "connected" : "not connected"}</span>
      </div>
      <p className="serif muted" style={{ margin: 0, fontSize: 17 }}>{info.plan}</p>
      {connected ? (
        <div><button className="btn btn-ghost" onClick={disconnect} disabled={busy}>Disconnect</button></div>
      ) : pending ? (
        <form className="stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); complete(); }}>
          <p className="notice" style={{ margin: 0 }}>{info.paste}</p>
          <input className="input mono" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste the address or code" autoFocus spellCheck={false} autoComplete="off" />
          <div className="row">
            <button className="btn btn-primary" disabled={busy || !pasted.trim()}>{busy ? "Connecting" : "Finish connecting"}</button>
            <button type="button" className="btn-text" onClick={start}>Open sign-in again</button>
            <button type="button" className="btn-text" onClick={() => setPending(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div><button className="btn btn-primary" onClick={start}>Connect {info.name}</button></div>
      )}
      <ErrorText error={error} />
    </div>
  );
}

export default function SettingsPage() {
  const { status, refreshStatus } = useAssistant();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabaseBrowser().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  return (
    <div>
      <h1 className="display">Settings</h1>

      <section className="section">
        <div className="spread"><h2 className="display">AI subscriptions</h2></div>
        <p className="serif muted" style={{ fontSize: 17, maxWidth: "62ch", marginTop: 0 }}>
          The assistant runs on your own subscription. Sign-in tokens are kept in secure cookies in this browser only and are never saved to the database.
        </p>
        <div className="grid-cells cols-2">
          {(["codex", "grok"] as const).map((p) => (
            <Connection key={p} provider={p} connected={Boolean(status?.[p])} onChange={refreshStatus} />
          ))}
        </div>
      </section>

      <section className="section">
        <div className="spread"><h2 className="display">Account</h2></div>
        <div className="row">
          <span className="mono">{email ?? "…"}</span>
          <form action="/auth/signout" method="post">
            <button className="btn btn-ghost">Sign out</button>
          </form>
        </div>
      </section>
    </div>
  );
}
