import { fromKobo, percentOf, toKobo, type Kobo } from "./money.js";

export interface Share {
  name: string;
  role: "LEAD" | "FOLLOWER";
  sharePercent: string;
}

/**
 * Splits an amount between co-insurers by share, in kobo. Each share is rounded half away from zero and the rounding
 * residue goes to the lead, so the parts always add up to the total.
 */
export function apportion(total: string, shares: Share[]): Array<Share & { amount: string }> {
  if (!shares.length) return [];
  const t = toKobo(total);
  const parts: Kobo[] = shares.map((s) => percentOf(t, s.sharePercent));
  const residue = t - parts.reduce((a, b) => a + b, 0n);
  const lead = Math.max(0, shares.findIndex((s) => s.role === "LEAD"));
  parts[lead] = parts[lead]! + residue;
  return shares.map((s, i) => ({ ...s, amount: fromKobo(parts[i]!) }));
}

/** True when the shares add up to exactly 100%. */
export function sharesComplete(percents: string[]) {
  return percents.reduce((a, p) => a + toKobo(p), 0n) === 10000n;
}
