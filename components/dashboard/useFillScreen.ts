"use client";

import { useCallback } from "react";

/**
 * Ref for an element that should reach the bottom of the screen: keeps its
 * distance from the top of the page in --top, which the stylesheet turns into
 * a min-height. Re-measures whenever the page above it changes height.
 */
export function useFillScreen<T extends HTMLElement>() {
  return useCallback((el: T | null) => {
    if (!el) return;
    const measure = () => el.style.setProperty("--top", `${Math.round(el.getBoundingClientRect().top + window.scrollY)}px`);
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);
}
