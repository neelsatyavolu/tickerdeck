import { newPanelId, PANEL_META, PANEL_TYPES, panelSchema, type Panel } from "./schema";

// The assistant proposes dashboard panels by writing a fenced block:
//
//   ```tickerdeck-panels
//   [{ "type": "compare", "symbols": ["NVDA", "AMD"], "range": "1Y", "width": 8 }]
//   ```
//
// The app validates each panel and shows an "Add to dashboard" button; nothing
// changes until the user clicks it. This works the same on every provider.

export const PANEL_FENCE = "tickerdeck-panels";
const FENCE_RE = new RegExp("```" + PANEL_FENCE + "\\s*\\n([\\s\\S]*?)```", "g");

export type Proposal = { panels: Panel[]; rejected: string[] };

/** Split assistant text into prose and panel proposals. */
export function extractProposals(text: string): { prose: string; proposals: Proposal[] } {
  const proposals: Proposal[] = [];
  const prose = text.replace(FENCE_RE, (_, body: string) => {
    proposals.push(parseProposal(body));
    return "";
  });
  return { prose: prose.replace(/\n{3,}/g, "\n\n").trim(), proposals };
}

export function parseProposal(body: string): Proposal {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return { panels: [], rejected: ["The proposed panels weren't valid JSON."] };
  }
  const list = Array.isArray(raw) ? raw : [raw];
  const panels: Panel[] = [];
  const rejected: string[] = [];
  for (const item of list.slice(0, 12)) {
    const candidate = typeof item === "object" && item !== null ? { width: defaultWidth(item), ...item, id: newPanelId() } : item;
    const parsed = panelSchema.safeParse(candidate);
    if (parsed.success) panels.push(parsed.data);
    else rejected.push(`${(item as { type?: string })?.type ?? "panel"}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  }
  return { panels, rejected };
}

function defaultWidth(item: object): number {
  const type = (item as { type?: string }).type;
  return type && type in PANEL_META ? PANEL_META[type as keyof typeof PANEL_META].width : 6;
}

/** What the model needs to know to write panels; goes into the system prompt. */
export function panelGuide(): string {
  const lines = PANEL_TYPES.map((t) => {
    const m = PANEL_META[t];
    const n = m.maxSymbols === 0 ? "no symbols; needs portfolioId" : m.minSymbols === m.maxSymbols ? `exactly ${m.minSymbols} symbol` : `${m.minSymbols}-${m.maxSymbols} symbols`;
    return `- ${t}: ${m.description} (${n})`;
  });
  return [
    "## Dashboard panels",
    "When the user asks you to add, build or show views/charts/panels on a dashboard, propose panels in a fenced block (the app shows the user an 'Add to dashboard' button; never claim you added them yourself):",
    "```" + PANEL_FENCE,
    '[{"type":"compare","title":"Chips, 1 year","symbols":["NVDA","AMD","AVGO"],"range":"1Y","width":8}]',
    "```",
    "Fields: type, symbols (US tickers; indexes as ^GSPC ^DJI ^IXIC ^NDX ^RUT ^VIX), optional title, width (3, 4, 6, 8 or 12 of a 12-column row), range (1M 3M 6M 1Y 2Y 5Y) for price/compare, horizon (1w 1m 3m 6m 1y) for forecast, portfolioId for portfolio.",
    "Types:",
    ...lines,
    "Keep a short sentence of explanation outside the block.",
  ].join("\n");
}
