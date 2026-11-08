/** Kosten in Franken aus Dollar (die Preisliste von Anthropic ist in Dollar). Unter zehn Rappen in Rappen, sonst in Franken. */
export function formatChf(usd: number, usdChf: number): string {
  const chf = usd * usdChf;
  if (chf < 0.001) return "< 0.1 Rp.";
  if (chf < 0.1) return `${(chf * 100).toFixed(1)} Rp.`;
  return `CHF ${chf.toFixed(2)}`;
}
