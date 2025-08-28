// PURPOSE: gentle rules so the form knows what's "good enough".
export function needText(t?: string, min = 2) {
  return !!t && t.trim().length >= min;
}
export function needPositiveInt(n?: number) {
  return typeof n === 'number' && Number.isInteger(n) && n > 0;
}
