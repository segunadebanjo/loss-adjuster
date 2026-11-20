// Money arrives from the API as a decimal string ("1250000.50"). Format for display only; never do arithmetic on
// it in the browser (the server computes every figure).
const naira = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 2 });
const nairaCompact = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** "1250000.5" -> "₦1,250,000.50"; null/blank -> "—". */
export function formatNaira(value: string | number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return (opts.compact ? nairaCompact : naira).format(n);
}
