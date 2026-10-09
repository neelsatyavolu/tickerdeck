// US stock market hours (NYSE/Nasdaq regular session, 9:30–4:00 ET, Mon–Fri).
// Exchange holidays aren't modelled; on those days this still says "open".

const OPEN_MIN = 9 * 60 + 30;
const CLOSE_MIN = 16 * 60;

/** Weekday (0 = Sun) and minutes since midnight in New York for a moment in time. */
function newYorkClock(now: Date): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

export type MarketStatus = { open: boolean; label: string };

export function marketStatus(now = new Date()): MarketStatus {
  const { day, minutes } = newYorkClock(now);
  const weekday = day >= 1 && day <= 5;
  if (weekday && minutes >= OPEN_MIN && minutes < CLOSE_MIN) return { open: true, label: "Market open · closes 4:00 PM ET" };
  if (weekday && minutes < OPEN_MIN) return { open: false, label: "Pre-market · opens 9:30 AM ET" };
  const nextDay = day === 5 || day === 6 ? "Monday" : day === 0 ? "Monday" : "tomorrow";
  return { open: false, label: `Market closed · opens ${nextDay} 9:30 AM ET` };
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
