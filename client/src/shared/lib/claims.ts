import type { ClaimStatus, PolicyType } from "@/shared/api/types";

export const STATUS_LABEL: Record<ClaimStatus, string> = {
  NEW_INSTRUCTION: "New instruction",
  INSPECTION_SCHEDULED: "Inspection scheduled",
  UNDER_INVESTIGATION: "Under investigation",
  PRELIM_REPORT_SUBMITTED: "Prelim report submitted",
  AWAITING_DOCUMENTS: "Awaiting documents",
  FINAL_REPORT_DRAFTED: "Final report drafted",
  PENDING_SIGNOFF: "Pending sign-off",
  SETTLED: "Settled",
  REPUDIATED: "Repudiated",
};

export const POLICY_TYPE_LABEL: Record<PolicyType, string> = {
  MOTOR: "Motor",
  PROPERTY_FIRE: "Property / Fire",
  MARINE_CARGO: "Marine Cargo",
  OIL_AND_GAS: "Oil & Gas",
  ENGINEERING_CAR: "Engineering / CAR",
  GENERAL_ACCIDENT: "General Accident",
};

const dateFmt = new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });

/** "2026-11-20" -> "20 Nov 2026". */
export function formatDate(iso: string | null | undefined) {
  return iso ? dateFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : "—";
}
/** ISO timestamp -> Lagos date and time. */
export function formatDateTime(iso: string | null | undefined) {
  return iso ? dateTimeFmt.format(new Date(iso)) : "—";
}
/** Today in Lagos, YYYY-MM-DD. */
export function todayLagos() {
  return new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
}
/** "1,250,000.50" -> "1250000.50" for the API (blank -> null). */
export function moneyToApi(v: string): string | null {
  const s = v.replace(/,/g, "").trim();
  return s === "" ? null : s;
}
/** API amount -> text for a MoneyInput. */
export function moneyToInput(v: string | null | undefined): string {
  if (v == null) return "";
  return Number(v).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
