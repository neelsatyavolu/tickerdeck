import { newPanelId, PANEL_META, PANEL_TYPES, panelSchema, type Panel } from "./schema";
import { tidyLayout } from "./tidy";

// The assistant changes dashboards by writing fenced JSON blocks. The app
// validates them and shows a one-click button; nothing changes until the user
// clicks. Works the same on every provider (no tool-calling needed).
//
//   ```tickerdeck-panels            → add these panels
//   [{ "type": "compare", "symbols": ["NVDA", "AMD"], "range": "1Y" }]
//   ```
//
//   ```tickerdeck-dashboard         → replace the open dashboard's layout
//   { "name": "Chips", "panels": [ …existing panels by id, edited, plus new ones… ] }
//   ```

export const PANEL_FENCE = "tickerdeck-panels";
export const DASHBOARD_FENCE = "tickerdeck-dashboard";
const FENCE_RE = new RegExp("```(" + PANEL_FENCE + "|" + DASHBOARD_FENCE + ")\\s*\\n([\\s\\S]*?)```", "g");
const MAX_PANELS = 40;

export type Proposal =
  | { kind: "add"; panels: Panel[]; rejected: string[] }
  | { kind: "replace"; name?: string; panels: Panel[]; rejected: string[] };

/** Split assistant text into prose and proposals. */
export function extractProposals(text: string): { prose: string; proposals: Proposal[] } {
  const proposals: Proposal[] = [];
  const prose = text.replace(FENCE_RE, (_, fence: string, body: string) => {
    proposals.push(fence === DASHBOARD_FENCE ? parseLayout(body) : parseProposal(body));
    return "";
  });
  return { prose: prose.replace(/\n{3,}/g, "\n\n").trim(), proposals };
}

function defaultWidth(item: object): number {
  const type = (item as { type?: string }).type;
  return type && type in PANEL_META ? PANEL_META[type as keyof typeof PANEL_META].width : 6;
}

/** Validate panels one by one; keep the good ones, explain the rest. Existing ids are kept (so edits diff cleanly). */
function parsePanels(list: unknown[], keepIds: boolean): { panels: Panel[]; rejected: string[] } {
  const panels: Panel[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  for (const item of list.slice(0, MAX_PANELS)) {
    if (typeof item !== "object" || item === null) {
      rejected.push("panel: not an object");
      continue;
    }
    const given = (item as { id?: unknown }).id;
    const id = keepIds && typeof given === "string" && given.length > 0 && given.length <= 40 && !seen.has(given) ? given : newPanelId();
    seen.add(id);
    const parsed = panelSchema.safeParse({ width: defaultWidth(item), ...item, id });
    if (parsed.success) panels.push(parsed.data);
    else rejected.push(`${(item as { type?: string }).type ?? "panel"}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  }
  return { panels, rejected };
}

function parseJson(body: string): unknown | undefined {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

export function parseProposal(body: string): Proposal {
  const raw = parseJson(body);
  if (raw === undefined) return { kind: "add", panels: [], rejected: ["The proposed panels weren't valid JSON."] };
  const { panels, rejected } = parsePanels(Array.isArray(raw) ? raw : [raw], false);
  // New panels arrive as their own full-width rows.
  return { kind: "add", panels: tidyLayout(panels), rejected };
}

export function parseLayout(body: string): Proposal {
  const raw = parseJson(body) as { name?: unknown; panels?: unknown } | undefined;
  if (raw === undefined || typeof raw !== "object" || raw === null || !Array.isArray(raw.panels)) {
    return { kind: "replace", panels: [], rejected: ["The proposed layout wasn't valid JSON with a panels list."] };
  }
  const { panels, rejected } = parsePanels(raw.panels, true);
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 80) : undefined;
  return { kind: "replace", name, panels: tidyLayout(panels), rejected };
}

export type LayoutDiff = { added: number; removed: number; changed: number; moved: boolean };

/** What applying a proposed layout would do to the current one. */
export function diffLayouts(current: Panel[], next: Panel[]): LayoutDiff {
  const before = new Map(current.map((p) => [p.id, p]));
  const after = new Map(next.map((p) => [p.id, p]));
  const kept = next.filter((p) => before.has(p.id));
  const keptBefore = current.filter((p) => after.has(p.id)).map((p) => p.id);
  return {
    added: next.filter((p) => !before.has(p.id)).length,
    removed: current.filter((p) => !after.has(p.id)).length,
    changed: kept.filter((p) => JSON.stringify(p) !== JSON.stringify(before.get(p.id))).length,
    moved: kept.map((p) => p.id).join() !== keptBefore.join(),
  };
}

/** What the model needs to know to build and edit dashboards; goes into the system prompt. */
export function panelGuide(): string {
  const types = PANEL_TYPES.map((t) => {
    const m = PANEL_META[t];
    const n = m.maxSymbols === 0 ? "no symbols; needs portfolioId" : m.minSymbols === m.maxSymbols ? `exactly ${m.minSymbols} symbol` : `${m.minSymbols}-${m.maxSymbols} symbols`;
    return `- ${t}: ${m.description} (${n}; default width ${m.width})`;
  });
  return [
    "## Dashboards",
    "You can build and edit the user's dashboards. Never claim you changed anything yourself: you propose, and the app shows the user a one-click button.",
    "",
    "To ADD panels to a dashboard, write:",
    "```" + PANEL_FENCE,
    '[{"type":"compare","title":"Chips, 1 year","symbols":["NVDA","AMD","AVGO"],"range":"1Y","width":8},{"type":"movers","title":"Chip movers","symbols":["NVDA","AMD","AVGO","INTC","QCOM"],"width":4}]',
    "```",
    "To EDIT the open dashboard (reorder, resize, retitle, change symbols, remove or add panels), write its complete new layout. Keep each existing panel's id; omit a panel to remove it; new panels have no id:",
    "```" + DASHBOARD_FENCE,
    '{"name":"Semiconductors","panels":[{"id":"ab12cd34","type":"tiles","title":"Chips today","symbols":["NVDA","AMD","AVGO"],"width":12},{"type":"compare","title":"1-year race","symbols":["NVDA","AMD","AVGO"],"range":"1Y","width":8}]}',
    "```",
    "Fields: type, symbols (US tickers; indexes as ^GSPC ^DJI ^IXIC ^NDX ^RUT ^VIX), title, width (3, 4, 6, 8 or 12 of a 12-column row), range (1M 3M 6M 1Y 2Y 5Y) for price/compare, horizon (1w 1m 3m 6m 1y) for forecast, portfolioId for portfolio.",
    "Panel types:",
    ...types,
    "",
    "Keep dashboards clean and organized:",
    "- Lead with a summary row: tiles or a heatmap at width 12.",
    "- Then the main chart (compare or price) at 8 beside a narrow companion at 4 (movers, news, analysts).",
    "- Pair detail panels at 6 + 6 or 4 + 4 + 4. Every row's widths should add up to exactly 12.",
    "- Group related panels next to each other (one theme or ticker per row); don't repeat the same view.",
    '- Short, specific titles (2-4 words, e.g. "Chips, 1 year"). Aim for 5-10 panels; never more than 12 per proposal.',
    "- Put a one-sentence explanation outside the block. Use one block per reply.",
  ].join("\n");
}
