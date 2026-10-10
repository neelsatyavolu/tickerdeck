// Display themes. The choice is stored in this browser (like the assistant
// defaults) and applied as a data-theme attribute on <html>. "system" leaves
// the attribute off, so the device's light/dark setting picks Ink or Paper.

export const THEMES = [
  { id: "system", label: "System", note: "Ink or Paper, following this device." },
  { id: "ink", label: "Ink", note: "Warm near-black. The default dark." },
  { id: "paper", label: "Paper", note: "Off-white, for bright rooms." },
  { id: "graphite", label: "Graphite", note: "Soft dark grey, kinder to old LCD panels." },
  { id: "salmon", label: "Salmon", note: "Financial-paper pink." },
  { id: "night", label: "Night", note: "Dimmed, for a screen left on after dark." },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export const THEME_KEY = "tickerdeck.theme";
export const DEFAULT_THEME: ThemeId = "system";

export function parseTheme(raw: unknown): ThemeId {
  return THEMES.find((t) => t.id === raw)?.id ?? DEFAULT_THEME;
}

const NAMED = THEMES.map((t) => t.id).filter((id) => id !== "system");

/** Runs in <head> before the first paint, so a saved theme never flashes. */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(${JSON.stringify(NAMED)}.indexOf(t)>=0)document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;
