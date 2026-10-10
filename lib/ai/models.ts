import "server-only";
import { bundledModels, loadModels, selectModels } from "@neelsatyavolu/shared-ai-auth";
import type { Provider } from "./providers";

// Add model IDs here only when tickerquill should hide them. New IDs show by default.
const HIDDEN_MODELS: Record<Provider, string[]> = { codex: [], grok: [] };
let cached = bundledModels;
let refreshAt = 0;

export async function aiModels(): Promise<Record<Provider, { id: string; label: string }[]>> {
  if (Date.now() >= refreshAt) {
    cached = await loadModels({ fallback: cached });
    refreshAt = Date.now() + 5 * 60_000;
  }
  return {
    codex: selectModels(cached, "codex", HIDDEN_MODELS.codex).map(({ id, label }) => ({ id, label })),
    grok: selectModels(cached, "grok", HIDDEN_MODELS.grok).map(({ id, label }) => ({ id, label })),
  };
}

/** The requested model if the catalog offers it, else the provider default or first entry. */
export async function resolveModel(provider: Provider, requested: string | undefined, fallback: string): Promise<string> {
  const list = (await aiModels())[provider];
  return list.find((m) => m.id === requested)?.id ?? list.find((m) => m.id === fallback)?.id ?? list[0]?.id ?? fallback;
}
