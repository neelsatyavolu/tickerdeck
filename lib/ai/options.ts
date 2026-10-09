// Assistant request options shared by the browser and the server.

export const EFFORTS = ["none", "low", "medium", "high", "xhigh"] as const;
export type Effort = (typeof EFFORTS)[number];

/** What each provider accepts. ChatGPT (Codex) takes the full range; Grok takes low–high. */
export const EFFORTS_BY_PROVIDER = { codex: EFFORTS, grok: ["low", "medium", "high"] as const } satisfies Record<"codex" | "grok", readonly Effort[]>;

export const DEFAULT_EFFORT: Effort = "low";

export const EFFORT_LABEL: Record<Effort, string> = { none: "None", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high" };

/** Clamp an effort to what the provider supports (e.g. Grok has no "none" or "xhigh"). */
export function effortFor(provider: "codex" | "grok", effort: Effort | undefined): Effort {
  const allowed = EFFORTS_BY_PROVIDER[provider] as readonly Effort[];
  const e = effort ?? DEFAULT_EFFORT;
  if (allowed.includes(e)) return e;
  return e === "none" ? "low" : e === "xhigh" ? "high" : DEFAULT_EFFORT;
}
