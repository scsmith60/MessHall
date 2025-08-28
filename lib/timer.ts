// PURPOSE: tiny countdown helpers so our component stays super clean.

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
