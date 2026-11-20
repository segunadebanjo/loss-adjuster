import type { Tx } from "../../lib/prisma.js";
import { computeSettlement } from "../../lib/settlement.js";

/** Works the settlement out from the claim, its policy and live lines, and stores the recommended figure. */
export async function recomputeSettlement(tx: Tx, claimId: number) {
  const claim = await tx.claim.findUniqueOrThrow({ where: { id: claimId }, include: { policy: true } });
  const items = await tx.valuationItem.findMany({ where: { claimId }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
  const settlement = computeSettlement({
    items: items.map((i) => ({
      category: i.category,
      claimedAmount: String(i.claimedAmount),
      assessedAmount: String(i.assessedAmount),
      depreciationAmount: String(i.depreciationAmount),
      bettermentDeduction: String(i.bettermentDeduction),
    })),
    sumInsured: String(claim.policy.sumInsured),
    valueAtRisk: claim.valueAtRisk == null ? null : String(claim.valueAtRisk),
    applyAverage: claim.applyAverage,
    excessAmount: String(claim.policy.excessAmount),
    excessPercentage: String(claim.policy.excessPercentage),
  });
  // No lines yet means no recommendation, not a ₦0 one.
  const recommended = items.length ? settlement.netRecommended : null;
  if (String(claim.recommendedSettlement ?? "") !== String(recommended ?? "")) {
    await tx.claim.update({ where: { id: claimId }, data: { recommendedSettlement: recommended } });
  }
  return { claim, items, settlement };
}

