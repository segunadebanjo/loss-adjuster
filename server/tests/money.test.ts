import { describe, expect, it } from "vitest";
import { fromKobo, mulDiv, percentOf, toKobo } from "../src/lib/money.js";

describe("money", () => {
  it("parses and formats without float error", () => {
    expect(toKobo("1,250,000.5")).toBe(125000050n);
    expect(toKobo("₦ 0.1")).toBe(10n);
    expect(toKobo(0.1 + 0.2)).toBe(30n);
    expect(toKobo("-12.34")).toBe(-1234n);
    expect(fromKobo(125000050n)).toBe("1250000.50");
    expect(fromKobo(-5n)).toBe("-0.05");
  });

  it("rejects bad amounts", () => {
    expect(() => toKobo("12.345")).toThrow();
    expect(() => toKobo("abc")).toThrow();
    expect(() => toKobo("")).toThrow();
  });

  it("rounds half away from zero", () => {
    expect(mulDiv(5n, 1n, 2n)).toBe(3n);
    expect(mulDiv(-5n, 1n, 2n)).toBe(-3n);
    expect(mulDiv(4n, 1n, 3n)).toBe(1n);
    expect(percentOf(toKobo("1000"), "7.5")).toBe(7500n);
    expect(percentOf(toKobo("0.10"), "7.5")).toBe(1n); // 0.75 kobo -> 1
  });
});
