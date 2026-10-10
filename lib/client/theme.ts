"use client";
import { useSyncExternalStore } from "react";
import { parseTheme, THEME_KEY, type ThemeId } from "../theme";

const EVENT = "tickerdeck:theme";

function read(): string {
  try {
    return localStorage.getItem(THEME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function subscribeTheme(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange); // other tabs
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export const storedTheme = (): ThemeId => parseTheme(read());

export function applyTheme(theme: ThemeId): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export function setTheme(theme: ThemeId): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage unavailable: the change lasts until reload */
  }
  applyTheme(theme);
  window.dispatchEvent(new Event(EVENT));
}

export function useTheme(): ThemeId {
  return parseTheme(useSyncExternalStore(subscribeTheme, read, () => ""));
}
