// /lib/timer.ts
// PURPOSE: tiny countdown helpers so our component stays super clean.
// like I'm 5: this file can turn "10–12 minutes" into seconds (720)

 /** seconds -> "MM:SS" (e.g., 125 => "02:05") */
export function fmtMMSS(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return `${mm}:${ss}`;
}

/** clamp number between min and max */
export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/* ------------------------- NEW: text → seconds -------------------------
   What it understands (case-insensitive):
   - "12 minutes", "12 min", "12 m"
   - "90 seconds", "90 sec", "90 s"
   - "1.5 hours", "1 1/2 hours", "1/2 hour"
   - Ranges pick the bigger number: "10-12 minutes", "10 to 12 min", "10–12 m"
   If nothing is found, it returns null (caller uses a default like 60s).
------------------------------------------------------------------------- */

/** Convert things like "1 1/2", "1/2", "1.5" to a number */
function numberishToFloat(raw: string): number {
  const s = raw.trim().toLowerCase().replace(',', '.');

  // support unicode fractions: ½ ¼ ¾
  const map: Record<string, string> = { '½': '1/2', '¼': '1/4', '¾': '3/4' };
  const replaced = s.replace(/[½¼¾]/g, (m) => map[m] ?? m);

  // "1 1/2"
  const mixed = replaced.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const whole = parseFloat(mixed[1]);
    const num = parseFloat(mixed[2]);
    const den = parseFloat(mixed[3]);
    return whole + (den ? num / den : 0);
  }

  // "1/2"
  const frac = replaced.match(/^(\d+)\/(\d+)$/);
  if (frac) {
    const num = parseFloat(frac[1]);
    const den = parseFloat(frac[2]);
    return den ? num / den : 0;
  }

  // plain number "1.5"
  return parseFloat(replaced);
}

/** Find and return the biggest duration (in seconds) written inside a sentence */
export function parseDurationFromText(text: string): number | null {
  if (!text) return null;

  // normalize dashes and "to" ranges so our regex is easier
  const t = text
    .toLowerCase()
    .replace(/[–—]/g, '-')           // en/em dashes -> hyphen
    .replace(/\bto\b/g, '-')         // "10 to 12" -> "10-12"
    .replace(/\s+/g, ' ');           // squeeze spaces

  // regex: [number][optional - number][unit]
  // number accepts "1", "1.5", "1/2", "1 1/2"
  const re =
    /(\d+(?:[.,]\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+)\s*(?:-?\s*(\d+(?:[.,]\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+))?\s*(hours?|hrs?|hr|h|minutes?|mins?|min|m|seconds?|secs?|sec|s)\b/g;

  let match: RegExpExecArray | null;
  let bestSeconds: number | null = null;

  while ((match = re.exec(t))) {
    const first = numberishToFloat(match[1]);
    const second = match[2] ? numberishToFloat(match[2]) : NaN;
    const unit = match[3];

    // choose the bigger value when it's a range (e.g., 10-12 -> 12)
    const value = isNaN(second) ? first : Math.max(first, second);

    // unit to seconds
    let multiplier = 60; // default minutes
    if (/^s(ec|ecs|econd|econds)?$/.test(unit)) multiplier = 1;
    else if (/^(h|hr|hrs|hour|hours)$/.test(unit)) multiplier = 3600;

    const seconds = Math.round(value * multiplier);

    // keep the largest reasonable match (helps if text says "preheat 5 min then bake 12 min")
    if (bestSeconds === null || seconds > bestSeconds) {
      bestSeconds = seconds;
    }
  }

  // guard-rails: limit to 99 minutes like UI does
  if (bestSeconds != null) {
    return clamp(bestSeconds, 1, 99 * 60);
  }
  return null;
}
