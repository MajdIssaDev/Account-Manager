export function formatSliderValue(value: number, isInt?: boolean): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  if (isInt) {
    return String(Math.round(value));
  }
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, "");
}
