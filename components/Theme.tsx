"use client";
import { useLayoutEffect } from "react";
import { applyTheme, setTheme, storedTheme, subscribeTheme, useTheme } from "@/lib/client/theme";
import { THEMES } from "@/lib/theme";

/**
 * Keeps <html data-theme> in step with the saved choice: after React's dev
 * remount clears the attribute the head script set, and when another tab
 * changes the theme.
 */
export function ThemeSync() {
  useLayoutEffect(() => {
    const sync = () => applyTheme(storedTheme());
    sync();
    return subscribeTheme(sync);
  }, []);
  return null;
}

export function ThemePicker() {
  const current = useTheme();
  return (
    <div className="theme-grid" role="group" aria-label="Theme">
      {THEMES.map((t) => (
        <button key={t.id} type="button" className="theme-option" aria-pressed={t.id === current} onClick={() => setTheme(t.id)}>
          {t.id === "system" ? (
            <span className="theme-swatch" aria-hidden="true">
              <span data-theme="ink"><i /></span>
              <span data-theme="paper"><i /></span>
            </span>
          ) : (
            <span className="theme-swatch" aria-hidden="true">
              <span data-theme={t.id}><i /></span>
            </span>
          )}
          <span className="mono" style={{ fontSize: 13 }}>{t.label}</span>
          <span className="faint" style={{ fontSize: 13 }}>{t.note}</span>
        </button>
      ))}
    </div>
  );
}
