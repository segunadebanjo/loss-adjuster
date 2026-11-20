import type { ClaimStatus, Role } from "@prisma/client";

/**
 * Every status move a person can make, and who may make it (CLAUDE.md section 7). The service checks the caller's
 * role, that an adjuster is the assigned one, the required inputs, and moves the status with a conditional update.
 * Later phases call the same moves from their own actions (scheduling an inspection, approving a report).
 */
export interface Transition {
  from: ClaimStatus[];
  to: ClaimStatus;
  roles: Role[];
  label: string;
  reasonRequired?: boolean;
  /** Settlement needs the agreed amount. */
  settledAmountRequired?: boolean;
  /** Made only by a report action (approve, submit, return), never by the transition endpoint. */
  viaReport?: string;
}

export const OPEN_STATUSES: ClaimStatus[] = [
  "NEW_INSTRUCTION",
  "INSPECTION_SCHEDULED",
  "UNDER_INVESTIGATION",
  "PRELIM_REPORT_SUBMITTED",
  "AWAITING_DOCUMENTS",
  "FINAL_REPORT_DRAFTED",
  "PENDING_SIGNOFF",
];
export const CLOSED_STATUSES: ClaimStatus[] = ["SETTLED", "REPUDIATED"];

export const CLAIM_TRANSITIONS: Transition[] = [
  { from: ["NEW_INSTRUCTION"], to: "INSPECTION_SCHEDULED", roles: ["ADMIN", "ADJUSTER"], label: "Inspection scheduled" },
  { from: ["INSPECTION_SCHEDULED"], to: "UNDER_INVESTIGATION", roles: ["ADMIN", "ADJUSTER"], label: "Inspection done, investigating" },
  { from: ["UNDER_INVESTIGATION"], to: "PRELIM_REPORT_SUBMITTED", roles: ["ADMIN"], label: "Preliminary report sent to insurer", viaReport: "Approve the preliminary report on the Reports tab." },
  { from: ["PRELIM_REPORT_SUBMITTED"], to: "AWAITING_DOCUMENTS", roles: ["ADMIN", "ADJUSTER"], label: "Awaiting claim documents" },
  { from: ["PRELIM_REPORT_SUBMITTED", "AWAITING_DOCUMENTS"], to: "FINAL_REPORT_DRAFTED", roles: ["ADMIN", "ADJUSTER"], label: "Documents complete, final report drafted" },
  { from: ["FINAL_REPORT_DRAFTED"], to: "PENDING_SIGNOFF", roles: ["ADMIN", "ADJUSTER"], label: "Submit for sign-off", viaReport: "Submit the final report on the Reports tab." },
  { from: ["PENDING_SIGNOFF"], to: "FINAL_REPORT_DRAFTED", roles: ["ADMIN"], label: "Return to adjuster", reasonRequired: true, viaReport: "Return the final report on the Reports tab." },
  { from: ["PENDING_SIGNOFF"], to: "SETTLED", roles: ["ADMIN"], label: "Mark settled", settledAmountRequired: true },
  { from: OPEN_STATUSES, to: "REPUDIATED", roles: ["ADMIN"], label: "Repudiate claim", reasonRequired: true },
  { from: CLOSED_STATUSES, to: "UNDER_INVESTIGATION", roles: ["ADMIN"], label: "Reopen claim", reasonRequired: true },
];

export function findTransition(from: ClaimStatus, to: ClaimStatus): Transition | undefined {
  return CLAIM_TRANSITIONS.find((t) => t.to === to && t.from.includes(from));
}

export const STATUS_LABEL: Record<ClaimStatus, string> = {
  NEW_INSTRUCTION: "New instruction",
  INSPECTION_SCHEDULED: "Inspection scheduled",
  UNDER_INVESTIGATION: "Under investigation",
  PRELIM_REPORT_SUBMITTED: "Preliminary report submitted",
  AWAITING_DOCUMENTS: "Awaiting documents",
  FINAL_REPORT_DRAFTED: "Final report drafted",
  PENDING_SIGNOFF: "Pending sign-off",
  SETTLED: "Settled",
  REPUDIATED: "Repudiated",
};

/** Dashboard "lines" grouping policy types (CLAUDE.md section 10). */
export const LINES = {
  MOTOR: { label: "Motor", types: ["MOTOR"] },
  MARINE: { label: "Marine", types: ["MARINE_CARGO"] },
  OIL_AND_GAS: { label: "Oil & Gas", types: ["OIL_AND_GAS"] },
  PROPERTY: { label: "Property", types: ["PROPERTY_FIRE", "ENGINEERING_CAR"] },
  GENERAL_ACCIDENT: { label: "General Accident", types: ["GENERAL_ACCIDENT"] },
} as const;
export type Line = keyof typeof LINES;
