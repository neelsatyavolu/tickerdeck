import { PANEL_WIDTHS, type Panel, type PanelWidth } from "./schema";

const COLUMNS = 12;

/** Group panels into rows the way the grid will lay them out. */
export function rows<T extends { width: number }>(panels: T[]): T[][] {
  const out: T[][] = [];
  let row: T[] = [];
  let used = 0;
  for (const p of panels) {
    if (used + p.width > COLUMNS && row.length) {
      out.push(row);
      row = [];
      used = 0;
    }
    row.push(p);
    used += p.width;
  }
  if (row.length) out.push(row);
  return out;
}

/**
 * Widen panels as little as possible so a row fills all 12 columns. Ties go to
 * widening later panels (the reader's eye lands on the first ones). Returns
 * null when no combination of allowed widths fits.
 */
export function fillRow(widths: number[]): PanelWidth[] | null {
  if (widths.reduce((a, b) => a + b, 0) === COLUMNS) return widths as PanelWidth[];
  let best: { widths: PanelWidth[]; cost: number; lateBias: number } | null = null;
  const choose = (i: number, acc: PanelWidth[], sum: number) => {
    if (sum > COLUMNS) return;
    if (i === widths.length) {
      if (sum !== COLUMNS) return;
      const cost = acc.reduce((c, w, k) => c + (w - widths[k]), 0);
      const lateBias = acc.reduce((c, w, k) => c + (w - widths[k]) * k, 0);
      if (!best || cost < best.cost || (cost === best.cost && lateBias > best.lateBias)) best = { widths: [...acc], cost, lateBias };
      return;
    }
    for (const w of PANEL_WIDTHS) if (w >= widths[i]) choose(i + 1, [...acc, w], sum + w);
  };
  choose(0, [], 0);
  return best ? (best as { widths: PanelWidth[] }).widths : null;
}

/** Make every row span the full width, without reordering anything. */
export function tidyLayout(panels: Panel[]): Panel[] {
  return rows(panels).flatMap((row) => {
    const widths = fillRow(row.map((p) => p.width));
    return widths ? row.map((p, i) => ({ ...p, width: widths[i] })) : row;
  });
}

export function isTidy(panels: Panel[]): boolean {
  return rows(panels).every((row) => row.reduce((a, p) => a + p.width, 0) === COLUMNS);
}
