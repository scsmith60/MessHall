// PURPOSE: teeny helpers so our UI is clean and readable.

/** 12345 -> "12.3k" */
export function compactNumber(n: number) {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0) + 'k';
  return (n / 1_000_000).toFixed(n % 1_000_000 >= 100_000 ? 1 : 0) + 'm';
}

/** ms timestamp -> "3h", "2d" */
export function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
