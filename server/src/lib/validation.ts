import { z } from "zod";
import { fromKobo, toKobo } from "./money.js";

// Plain-English defaults for messages a schema doesn't set itself (shown next to form fields).
z.config({
  customError: (issue) => {
    if (issue.code === "invalid_type" && (issue.input === undefined || issue.input === null || Number.isNaN(issue.input))) {
      return "This field is required.";
    }
    if (issue.code === "invalid_value") return "Pick one of the options.";
    return undefined;
  },
});

/** A money amount (string or number) -> normalised "1234.50"; at most 2 decimals, never negative, ≤ 999 trillion. */
export const zMoney = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    try {
      const k = toKobo(v);
      if (k < 0n) throw new Error("negative");
      if (k > 99_999_999_999_999_99n) throw new Error("too large");
      return fromKobo(k);
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter an amount in naira, e.g. 1,250,000.00 (no negatives)." });
      return z.NEVER;
    }
  });

/** Percentage 0-100 with up to 2 decimals -> "12.50". */
export const zPercent = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    try {
      const k = toKobo(v);
      if (k < 0n || k > 10000n) throw new Error("range");
      return fromKobo(k);
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a percentage between 0 and 100." });
      return z.NEVER;
    }
  });

/** "YYYY-MM-DD" that is a real calendar date. One message per problem, blank first. */
export const zDate = z.string({ message: "Enter a date." }).superRefine((s, ctx) => {
  if (s.trim() === "") ctx.addIssue({ code: "custom", message: "Enter a date." });
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) ctx.addIssue({ code: "custom", message: "Use the format YYYY-MM-DD." });
  else if (Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) || !new Date(`${s}T00:00:00Z`).toISOString().startsWith(s))
    ctx.addIssue({ code: "custom", message: "Not a real date." });
});

export const zId = z.coerce.number().int().positive();

/** Optional text: trims, and turns "" into null. */
export const zText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === "" ? null : s))
    .nullable()
    .optional();

export const zRequiredText = (max: number, message = "This field is required.") =>
  z.string().trim().min(1, message).max(max);

/** Query-string list: "A,B" or repeated ?x=A&x=B. */
export const zCsv = <T extends z.ZodType<unknown, string>>(item: T) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(",")).map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(item));

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
