import { toKobo } from "./money.js";

export interface Tier {
  label: string;
  minAmount: string;
  requiredApprovals: number;
}

/** The tier for an amount: the one with the highest minimum at or below it. No tiers (or none matching) means one sign-off. */
export function tierFor(tiers: Tier[], amount: string | null): Tier {
  const a = toKobo(amount ?? "0");
  const fit = tiers.filter((t) => toKobo(t.minAmount) <= a).sort((x, y) => (toKobo(y.minAmount) > toKobo(x.minAmount) ? 1 : -1))[0];
  return fit ?? { label: "Standard", minAmount: "0.00", requiredApprovals: 1 };
}

/** Checks a whole matrix before it is saved; returns a message, or null when it is fine. */
export function matrixProblem(tiers: Tier[]): string | null {
  if (!tiers.length) return "Keep at least one tier.";
  const mins = tiers.map((t) => toKobo(t.minAmount));
  if (!mins.includes(0n)) return "One tier must start at NGN 0.00, so every report has a tier.";
  if (new Set(mins.map(String)).size !== mins.length) return "Two tiers start at the same amount.";
  const sorted = [...tiers].sort((x, y) => (toKobo(x.minAmount) < toKobo(y.minAmount) ? -1 : 1));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.requiredApprovals < sorted[i - 1]!.requiredApprovals) return "A larger amount can't need fewer sign-offs than a smaller one.";
  }
  return null;
}
