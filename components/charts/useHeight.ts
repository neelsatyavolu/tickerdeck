"use client";

import { useEffect, useRef, useState } from "react";

/** Tracks an element's height so a chart can grow into a panel that was stretched taller. */
export function useHeight<T extends HTMLElement>(min: number) {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState(min);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setHeight(Math.max(min, Math.floor(entry.contentRect.height))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [min]);
  return [ref, height] as const;
}
