// Naira amounts as integer kobo (bigint). Never use JS floats for money: parse the decimal string, do integer
// maths, and format back. Prisma Decimal values go through toKobo(String(value)).

export type Kobo = bigint;

const AMOUNT = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

/** "1,250,000.5" | "1250000.50" | 1250000.5 | Decimal -> 125000050n. Throws on anything else. */
export function toKobo(value: string | number | { toString(): string }): Kobo {
  const text = (typeof value === "number" ? value.toFixed(2) : String(value)).replace(/[,\s₦]/g, "");
  const m = AMOUNT.exec(text);
  if (!m) throw new Error(`Not a valid amount: ${String(value)}`);
  const naira = BigInt(m[2]!);
  const kobo = BigInt((m[3] ?? "").padEnd(2, "0"));
  const total = naira * 100n + kobo;
  return m[1] ? -total : total;
}

/** 125000050n -> "1250000.50" (the API's money format). */
export function fromKobo(kobo: Kobo): string {
  const neg = kobo < 0n;
  const abs = neg ? -kobo : kobo;
  const naira = abs / 100n;
  const rest = (abs % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${naira}.${rest}`;
}

/** a * num / den, rounded half away from zero. */
export function mulDiv(a: Kobo, num: bigint, den: bigint): Kobo {
  if (den === 0n) throw new Error("Division by zero");
  const neg = (a < 0n) !== (num < 0n) !== (den < 0n);
  const n = (a < 0n ? -a : a) * (num < 0n ? -num : num);
  const d = den < 0n ? -den : den;
  const q = (n * 2n + d) / (2n * d);
  return neg && q !== 0n ? -q : q;
}

/** Percentage given as a decimal string with up to 2 places ("7.5") applied to an amount, rounded half away. */
export function percentOf(amount: Kobo, percent: string | number | { toString(): string }): Kobo {
  const basisPoints = toKobo(percent); // "7.5" -> 750 hundredths of a percent
  return mulDiv(amount, basisPoints, 10000n);
}

export const maxKobo = (a: Kobo, b: Kobo): Kobo => (a > b ? a : b);
export const minKobo = (a: Kobo, b: Kobo): Kobo => (a < b ? a : b);

/** Decimal | null from Prisma -> API string | null. */
export function moneyOut(value: { toString(): string } | null | undefined): string | null {
  return value == null ? null : fromKobo(toKobo(value.toString()));
}
