"use client";
import { useEffect, useState, useSyncExternalStore } from "react";

export type WakeState = "off" | "pending" | "held" | "unsupported" | "refused";

const never = () => () => {};
const supportsWakeLock = () => "wakeLock" in navigator;

/**
 * Keeps the screen on while `active`, for dashboards left open as a display.
 * The browser drops the lock whenever the tab is hidden, so it is taken again
 * each time the tab comes back.
 */
export function useWakeLock(active: boolean): WakeState {
  const [result, setResult] = useState<"held" | "refused" | null>(null);
  // Read on the client only; the server render assumes support so hydration matches.
  const supported = useSyncExternalStore(never, supportsWakeLock, () => true);

  useEffect(() => {
    if (!active || !supported) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const acquire = async () => {
      if (stopped || lock || document.visibilityState !== "visible") return;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (stopped) {
          await next.release();
          return;
        }
        lock = next;
        // The device can take the lock back (low battery); stop claiming it until it is re-taken.
        next.addEventListener("release", () => {
          lock = null;
          if (!stopped) setResult(null);
        });
        setResult("held");
      } catch {
        // Battery saver or a browser policy said no; the device's own timer applies.
        if (!stopped) setResult("refused");
      }
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", acquire);
      lock?.release().catch(() => { /* already released by the browser */ });
      setResult(null);
    };
  }, [active, supported]);

  if (!active) return "off";
  if (!supported) return "unsupported";
  return result ?? "pending";
}
