"use client";

import { useEffect, useState } from "react";
import { Seg } from "@/components/ui";
import { EFFORT_LABEL, EFFORTS_BY_PROVIDER, type Effort } from "@/lib/ai/options";
import { effortOf, updateAiPrefs, useAiPrefs, type Provider } from "@/lib/client/aiPrefs";

type Models = Record<Provider, { id: string; label: string }[]>;
const NAME: Record<Provider, string> = { codex: "ChatGPT", grok: "Grok" };

/** Settings → default provider, model and reasoning effort, and ChatGPT Fast mode. */
export function AssistantDefaults({ connected }: { connected: Record<Provider, boolean> | null }) {
  const prefs = useAiPrefs();
  const [models, setModels] = useState<Models | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai/models")
      .then((r) => r.json() as Promise<Models>)
      .then((m) => !cancelled && setModels(m))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const providers: Provider[] = ["codex", "grok"];
  const defaultProvider = prefs.provider ?? (connected?.grok && !connected.codex ? "grok" : "codex");

  return (
    <div className="stack" style={{ gap: 0 }}>
      <div className="grid-cells cols-2">
        <div className="stack" style={{ gap: 8 }}>
          <div className="label" style={{ color: "var(--fg)" }}>Default assistant</div>
          <p className="notice" style={{ margin: 0 }}>Which subscription answers when both are connected.</p>
          <Seg label="Default assistant" value={NAME[defaultProvider]} options={["ChatGPT", "Grok"] as const} onChange={(v) => updateAiPrefs((p) => ({ ...p, provider: v === "Grok" ? "grok" : "codex" }))} />
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <div className="label" style={{ color: "var(--fg)" }}>How these apply</div>
          <p className="notice" style={{ margin: 0 }}>Saved in this browser, like your sign-ins. The model can still be switched from the assistant window.</p>
        </div>
        {providers.map((p) => (
          <div key={p} className="stack" style={{ gap: 12, opacity: connected && !connected[p] ? 0.6 : 1 }}>
            <div className="spread">
              <div className="label" style={{ color: "var(--fg)" }}>{NAME[p]}</div>
              {connected && !connected[p] && <span className="faint mono" style={{ fontSize: 11 }}>not connected</span>}
            </div>
            <label className="field">
              <span className="label">Default model</span>
              <select className="input" value={prefs.model[p] ?? ""} onChange={(e) => updateAiPrefs((x) => ({ ...x, model: { ...x.model, [p]: e.target.value || undefined } }))}>
                <option value="">{NAME[p]} default</option>
                {models?.[p]?.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            <div className="field">
              <span className="label">Reasoning effort</span>
              <Seg
                label={`${NAME[p]} reasoning effort`}
                value={EFFORT_LABEL[effortOf(prefs, p)]}
                options={EFFORTS_BY_PROVIDER[p].map((e) => EFFORT_LABEL[e])}
                onChange={(label) => {
                  const effort = (Object.keys(EFFORT_LABEL) as Effort[]).find((e) => EFFORT_LABEL[e] === label);
                  if (effort) updateAiPrefs((x) => ({ ...x, effort: { ...x.effort, [p]: effort } }));
                }}
              />
              <span className="notice">Higher effort thinks longer: slower, more thorough answers.</span>
            </div>
            {p === "codex" && (
              <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={prefs.fast}
                  aria-label="ChatGPT Fast mode"
                  className="switch"
                  onClick={() => updateAiPrefs((x) => ({ ...x, fast: !x.fast }))}
                >
                  <span className="switch-knob" />
                </button>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>Fast mode {prefs.fast ? "on" : "off"}</div>
                  <div className="notice">Faster answers using priority processing. Uses your plan&apos;s credits faster; if your plan doesn&apos;t include it, answers run at standard speed and the assistant tells you.</div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
