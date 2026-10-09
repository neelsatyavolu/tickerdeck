"use client";
import { useMemo, useSyncExternalStore } from "react";
import { DEFAULT_EFFORT, type Effort } from "../ai/options";

// Assistant defaults, stored in this browser (like the subscription tokens).
// Settings and the assistant window share them through one store.

export type Provider = "codex" | "grok";
export type AiPrefs = {
  provider?: Provider;
  model: Partial<Record<Provider, string>>;
  effort: Partial<Record<Provider, Effort>>;
  /** ChatGPT Fast mode. */
  fast: boolean;
};

const KEY = "tickerdeck.ai";
const EVENT = "tickerdeck:ai-prefs";
const EMPTY: AiPrefs = { model: {}, effort: {}, fast: false };

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

function parse(raw: string): AiPrefs {
  try {
    const v = raw ? JSON.parse(raw) : {};
    return { provider: v.provider, model: v.model ?? {}, effort: v.effort ?? {}, fast: Boolean(v.fast) };
  } catch {
    return EMPTY;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange); // other tabs
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function updateAiPrefs(change: (p: AiPrefs) => AiPrefs): void {
  const next = change(parse(read()));
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: the change lasts until reload */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useAiPrefs(): AiPrefs {
  const raw = useSyncExternalStore(subscribe, read, () => "");
  return useMemo(() => parse(raw), [raw]);
}

export const effortOf = (p: AiPrefs, provider: Provider): Effort => p.effort[provider] ?? DEFAULT_EFFORT;
