"use client";

import { useState } from "react";
import { nearestIndex } from "@/lib/chart";

/**
 * Hover crosshair plus press-and-drag measuring for charts drawn at pixel
 * positions `xs`. While the pointer is held, `anchor` is where the press
 * started and `hover` follows the pointer; releasing ends the measurement.
 */
export function useDragMeasure(xs: number[], minX = -Infinity) {
  const [hover, setHover] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);

  const at = (e: React.PointerEvent<SVGSVGElement>) => {
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    return px < minX || xs.length === 0 ? null : nearestIndex(xs, px);
  };

  const handlers = {
    onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => {
      const i = at(e);
      if (i === null) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setAnchor(i);
      setHover(i);
    },
    onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => setHover(at(e)),
    onPointerUp: () => setAnchor(null),
    onPointerCancel: () => {
      setAnchor(null);
      setHover(null);
    },
    onPointerLeave: () => {
      if (anchor === null) setHover(null);
    },
  };

  const measuring = anchor !== null && hover !== null && anchor !== hover;
  return { hover, anchor, measuring, handlers };
}
