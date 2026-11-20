import { describe, expect, it } from "vitest";
import { computeSettlement, lineNet } from "../src/lib/settlement.js";

const line = (category: string, claimed: string, assessed: string, dep = "0", bet = "0") => ({
  category, claimedAmount: claimed, assessedAmount: assessed, depreciationAmount: dep, bettermentDeduction: bet,
});
const base = { sumInsured: "1000000.00", valueAtRisk: null, applyAverage: false, excessAmount: "0", excessPercentage: "0" };

describe("lineNet", () => {
  it("deducts depreciation and betterment, never below zero", () => {
    expect(lineNet(line("Plant & Machinery", "100", "100", "20", "5"))).toBe(7500n);
    expect(lineNet(line("Plant & Machinery", "100", "10", "20", "5"))).toBe(0n);
    expect(lineNet(line("Salvage Recovery", "0", "40"))).toBe(4000n);
  });
});

describe("computeSettlement", () => {
  it("adds up the lines and deducts salvage", () => {
    const s = computeSettlement({
      ...base,
      items: [line("Motor Parts", "500000", "450000", "50000"), line("Labor", "100000", "80000"), line("Salvage Recovery", "0", "30000")],
    });
    expect(s).toMatchObject({ totalClaimed: "600000.00", totalAssessed: "530000.00", totalDepreciation: "50000.00", salvage: "30000.00", grossLoss: "450000.00", lossAfterAverage: "450000.00", netRecommended: "450000.00", savings: "150000.00" });
    expect(s.average.applied).toBe(false);
  });

  it("applies average only when underinsured", () => {
    const items = [line("Building/Civil Works", "800000", "800000")];
    // Sum insured 1m, value at risk 1.25m -> 80% of the loss.
    const under = computeSettlement({ ...base, items, applyAverage: true, valueAtRisk: "1250000" });
    expect(under.average).toMatchObject({ applied: true, ratioPercent: "80.00", reduction: "160000.00" });
    expect(under.netRecommended).toBe("640000.00");
    // Adequately insured: unchanged.
    const ok = computeSettlement({ ...base, items, applyAverage: true, valueAtRisk: "900000" });
    expect(ok.average.applied).toBe(false);
    expect(ok.netRecommended).toBe("800000.00");
    // Not entered: warn, don't apply.
    const missing = computeSettlement({ ...base, items, applyAverage: true });
    expect(missing.average.applied).toBe(false);
    expect(missing.warnings.join(" ")).toMatch(/value at risk/);
    // Switched off: ignored even when underinsured.
    expect(computeSettlement({ ...base, items, valueAtRisk: "5000000" }).netRecommended).toBe("800000.00");
  });

  it("deducts whichever excess is greater, after average", () => {
    const items = [line("Stock & Contents", "1000000", "1000000")];
    // 10% of 800k (after average) = 80k beats the 50k fixed excess.
    const pct = computeSettlement({ ...base, sumInsured: "1000000", items, applyAverage: true, valueAtRisk: "1250000", excessAmount: "50000", excessPercentage: "10" });
    expect(pct.excess).toMatchObject({ percentageAmount: "80000.00", applied: "80000.00", basis: "PERCENTAGE" });
    expect(pct.netRecommended).toBe("720000.00");
    // Fixed beats a small percentage.
    const fixed = computeSettlement({ ...base, items, excessAmount: "150000", excessPercentage: "5" });
    expect(fixed.excess).toMatchObject({ applied: "150000.00", basis: "FIXED" });
    expect(fixed.netRecommended).toBe("850000.00");
    expect(computeSettlement({ ...base, items }).excess.basis).toBe("NONE");
  });

  it("never pays below zero or above the sum insured", () => {
    const tiny = computeSettlement({ ...base, items: [line("Motor Parts", "30000", "30000")], excessAmount: "50000" });
    expect(tiny.netRecommended).toBe("0.00");
    expect(tiny.warnings.join(" ")).toMatch(/excess/);
    const big = computeSettlement({ ...base, sumInsured: "500000", items: [line("Building/Civil Works", "900000", "900000")] });
    expect(big).toMatchObject({ netRecommended: "500000.00", cappedAtSumInsured: true });
    const salvageHeavy = computeSettlement({ ...base, items: [line("Labor", "10", "10"), line("Salvage Recovery", "0", "50")] });
    expect(salvageHeavy.grossLoss).toBe("0.00");
  });

  it("rounds to the kobo, half away from zero", () => {
    // 100.01 x 1/3 = 33.3366... -> 33.34
    const s = computeSettlement({ ...base, sumInsured: "1", items: [line("Labor", "100.01", "100.01")], applyAverage: true, valueAtRisk: "3" });
    expect(s.lossAfterAverage).toBe("33.34");
    expect(s.average.ratioPercent).toBe("33.33");
    // An empty schedule is all zeros.
    expect(computeSettlement({ ...base, items: [] }).netRecommended).toBe("0.00");
  });
});
