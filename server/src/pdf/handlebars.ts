import Handlebars from "handlebars";

/** "1250000.5" | 1250000.5 -> "1,250,000.50" (en-NG grouping, 2 decimals). Strings are formatted without floats. */
export function formatNaira(value: unknown): string {
  if (value == null || value === "") return "0.00";
  const text = typeof value === "number" ? value.toFixed(2) : String(value).replace(/[,\s₦]/g, "");
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return String(value);
  const whole = BigInt(m[2]!).toLocaleString("en-NG");
  return `${m[1] ? "-" : ""}${whole}.${(m[3] ?? "").padEnd(2, "0")}`;
}

const dateFmt = new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" });
export function formatDate(value: unknown): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(String(value).length === 10 ? `${String(value)}T12:00:00Z` : String(value));
  return Number.isNaN(d.getTime()) ? String(value) : dateFmt.format(d);
}

/** A Handlebars instance of our own (not the global one), with the helpers the templates use. */
export function createHandlebars() {
  const hb = Handlebars.create();
  hb.registerHelper("formatCurrency", (v: unknown) => formatNaira(v));
  hb.registerHelper("formatNaira", (v: unknown) => `₦${formatNaira(v)}`);
  hb.registerHelper("formatDate", (v: unknown) => formatDate(v));
  hb.registerHelper("formatPercent", (v: unknown) => (v == null || v === "" ? "" : `${Number(v)}`));
  hb.registerHelper("eq", (a: unknown, b: unknown) => a === b);
  hb.registerHelper("inc", (i: unknown) => Number(i) + 1);
  hb.registerHelper("default", (v: unknown, fallback: unknown) => (v == null || v === "" ? fallback : v));
  // Paragraph breaks in typed text become <br> (the text itself is escaped first).
  hb.registerHelper("paragraphs", (v: unknown) => new hb.SafeString(hb.escapeExpression(String(v ?? "")).replace(/\r?\n/g, "<br>")));
  return hb;
}
