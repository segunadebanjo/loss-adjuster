import { toKobo } from "./money.js";

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const SCALES = ["", "Thousand", "Million", "Billion", "Trillion"];

function underThousand(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (rest) {
    const words = rest < 20 ? ONES[rest]! : `${TENS[Math.floor(rest / 10)]}${rest % 10 ? `-${ONES[rest % 10]}` : ""}`;
    parts.push(h ? `and ${words}` : words);
  }
  return parts.join(" ");
}

function wholeInWords(n: bigint): string {
  if (n === 0n) return "Zero";
  const groups: number[] = [];
  for (let x = n; x > 0n; x /= 1000n) groups.push(Number(x % 1000n));
  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]!;
    if (!g) continue;
    // British usage: "One Million and Five" when the last group is under 100 and something precedes it.
    const prefix = i === 0 && words.length && g < 100 ? "and " : "";
    words.push(`${prefix}${underThousand(g)}${SCALES[i] ? ` ${SCALES[i]}` : ""}`);
  }
  return words.join(", ").replace(/, and /g, " and ");
}

/** "12285000.50" -> "Twelve Million, Two Hundred and Eighty-Five Thousand Naira and Fifty Kobo Only". */
export function nairaInWords(amount: string): string {
  const k = toKobo(amount);
  if (k < 0n) return `Minus ${nairaInWords(String(-k / 100n) + "." + String(-k % 100n).padStart(2, "0"))}`;
  const naira = k / 100n;
  const kobo = Number(k % 100n);
  const n = `${wholeInWords(naira)} Naira`;
  return `${kobo ? `${n} and ${wholeInWords(BigInt(kobo))} Kobo` : n} Only`;
}
