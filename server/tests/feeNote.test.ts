import { describe, expect, it } from "vitest";
import { computeFeeNote } from "../src/lib/feeNote.js";
import { nairaInWords } from "../src/lib/amountInWords.js";

describe("computeFeeNote", () => {
  it("charges VAT and withholds WHT on the professional fee only (expenses pass through)", () => {
    const f = computeFeeNote({
      professionalFee: "1000000",
      expenses: [{ description: "Travel to Port Harcourt", amount: "150000" }, { description: "Photographs", amount: "50000" }],
      vatRate: "7.5",
      whtRate: "10",
    });
    expect(f).toEqual({
      professionalFee: "1000000.00",
      expensesTotal: "200000.00",
      grossAmount: "1200000.00",
      vatRate: "7.50",
      vatAmount: "75000.00",
      invoiceTotal: "1275000.00",
      whtRate: "10.00",
      whtAmount: "100000.00",
      netPayable: "1175000.00",
    });
  });
  it("rounds VAT and WHT to the kobo", () => {
    const f = computeFeeNote({ professionalFee: "333.33", expenses: [], vatRate: "7.5", whtRate: "5" });
    expect(f.vatAmount).toBe("25.00"); // 24.99975 -> 25.00
    expect(f.whtAmount).toBe("16.67"); // 16.6665 -> 16.67
    expect(f.netPayable).toBe("341.66");
  });
});

describe("nairaInWords", () => {
  it.each([
    ["0", "Zero Naira Only"],
    ["5", "Five Naira Only"],
    ["21", "Twenty-One Naira Only"],
    ["105", "One Hundred and Five Naira Only"],
    ["1000005", "One Million and Five Naira Only"],
    ["12285000", "Twelve Million, Two Hundred and Eighty-Five Thousand Naira Only"],
    ["1190000.50", "One Million, One Hundred and Ninety Thousand Naira and Fifty Kobo Only"],
    ["2400000000", "Two Billion, Four Hundred Million Naira Only"],
  ])("%s -> %s", (amount, words) => {
    expect(nairaInWords(amount)).toBe(words);
  });
});
