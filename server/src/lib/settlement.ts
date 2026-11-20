import { fromKobo, maxKobo, minKobo, mulDiv, percentOf, toKobo, type Kobo } from "./money.js";

/**
 * Schedule of loss -> net recommended settlement (CLAUDE.md section 5). Pure: no database, integer kobo,
 * half-away-from-zero rounding. The API, the UI and the PDFs all show the object this returns.
 *
 *   line net        = assessed - depreciation - betterment          (Salvage Recovery lines: the amount recovered)
 *   gross loss      = sum of line nets - salvage                     (not below zero)
 *   average         = gross x sum insured / value at risk            (only if applied and value at risk > sum insured)
 *   excess          = greater of the fixed excess and excess % x loss after average
 *   net recommended = loss after average - excess, not below zero, not above the sum insured
 */
export const SALVAGE_CATEGORY = "Salvage Recovery";

export interface SettlementLineInput {
  category: string;
  claimedAmount: string;
  assessedAmount: string;
  depreciationAmount: string;
  bettermentDeduction: string;
}

export interface SettlementInput {
  items: SettlementLineInput[];
  sumInsured: string;
  valueAtRisk: string | null;
  applyAverage: boolean;
  excessAmount: string;
  excessPercentage: string;
}

export type ExcessBasis = "FIXED" | "PERCENTAGE" | "NONE";

export interface Settlement {
  lineCount: number;
  totalClaimed: string;
  totalAssessed: string;
  totalDepreciation: string;
  totalBetterment: string;
  salvage: string;
  grossLoss: string;
  average: {
    applied: boolean;
    /** Sum insured / value at risk as a percentage with 2 decimals, e.g. "86.54"; null when not applied. */
    ratioPercent: string | null;
    reduction: string;
    reason: string;
  };
  lossAfterAverage: string;
  excess: { fixed: string; percentage: string; percentageAmount: string; applied: string; basis: ExcessBasis };
  netBeforeCap: string;
  cappedAtSumInsured: boolean;
  netRecommended: string;
  /** What the adjuster saved the insurer against the amounts claimed. */
  savings: string;
  warnings: string[];
}

/** Net payable for one line, in kobo. Salvage lines return the amount recovered (positive). */
export function lineNet(line: Pick<SettlementLineInput, "category" | "assessedAmount" | "depreciationAmount" | "bettermentDeduction">): Kobo {
  const assessed = toKobo(line.assessedAmount);
  if (line.category === SALVAGE_CATEGORY) return assessed;
  return maxKobo(0n, assessed - toKobo(line.depreciationAmount) - toKobo(line.bettermentDeduction));
}

export function computeSettlement(input: SettlementInput): Settlement {
  const warnings: string[] = [];
  let claimed = 0n, assessed = 0n, depreciation = 0n, betterment = 0n, salvage = 0n, nets = 0n;
  for (const item of input.items) {
    if (item.category === SALVAGE_CATEGORY) {
      salvage += toKobo(item.assessedAmount);
      continue;
    }
    claimed += toKobo(item.claimedAmount);
    assessed += toKobo(item.assessedAmount);
    depreciation += toKobo(item.depreciationAmount);
    betterment += toKobo(item.bettermentDeduction);
    nets += lineNet(item);
  }
  const gross = maxKobo(0n, nets - salvage);
  if (salvage > nets) warnings.push("Salvage is more than the assessed loss; the loss is taken as nil.");

  const sumInsured = toKobo(input.sumInsured);
  const var_ = input.valueAtRisk == null ? null : toKobo(input.valueAtRisk);
  let afterAverage = gross;
  let average: Settlement["average"];
  if (!input.applyAverage) {
    average = { applied: false, ratioPercent: null, reduction: "0.00", reason: "The average clause does not apply to this claim." };
  } else if (var_ == null || var_ === 0n) {
    average = { applied: false, ratioPercent: null, reduction: "0.00", reason: "No value at risk entered, so average was not tested." };
    warnings.push("Enter the value at risk to test for underinsurance.");
  } else if (var_ <= sumInsured) {
    average = { applied: false, ratioPercent: null, reduction: "0.00", reason: "Sum insured covers the value at risk: no underinsurance." };
  } else {
    afterAverage = mulDiv(gross, sumInsured, var_);
    average = {
      applied: true,
      ratioPercent: fromKobo(mulDiv(sumInsured, 10000n, var_)),
      reduction: fromKobo(gross - afterAverage),
      reason: "Underinsured: the value at risk is more than the sum insured, so the loss is reduced in proportion.",
    };
  }

  const fixed = toKobo(input.excessAmount);
  const pctAmount = percentOf(afterAverage, input.excessPercentage);
  const excess = maxKobo(fixed, pctAmount);
  const basis: ExcessBasis = excess === 0n ? "NONE" : pctAmount > fixed ? "PERCENTAGE" : "FIXED";
  const netBeforeCap = maxKobo(0n, afterAverage - excess);
  const net = minKobo(netBeforeCap, sumInsured);
  if (afterAverage > 0n && excess >= afterAverage) warnings.push("The excess is at least the loss: nothing is payable.");
  if (net < netBeforeCap) warnings.push("Capped at the sum insured.");

  return {
    lineCount: input.items.length,
    totalClaimed: fromKobo(claimed),
    totalAssessed: fromKobo(assessed),
    totalDepreciation: fromKobo(depreciation),
    totalBetterment: fromKobo(betterment),
    salvage: fromKobo(salvage),
    grossLoss: fromKobo(gross),
    average,
    lossAfterAverage: fromKobo(afterAverage),
    excess: { fixed: fromKobo(fixed), percentage: input.excessPercentage, percentageAmount: fromKobo(pctAmount), applied: fromKobo(excess), basis },
    netBeforeCap: fromKobo(netBeforeCap),
    cappedAtSumInsured: net < netBeforeCap,
    netRecommended: fromKobo(net),
    savings: fromKobo(maxKobo(0n, claimed - net)),
    warnings,
  };
}
