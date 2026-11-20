import { z } from "zod";
import { NIGERIAN_STATES } from "../../lib/nigeria.js";
import { LINES } from "../../lib/claimWorkflow.js";
import { paginationSchema, zCsv, zDate, zMoney, zRequiredText, zText } from "../../lib/validation.js";
import { POLICY_TYPES, policyInput } from "../policies/policies.service.js";

export const CLAIM_STATUSES = [
  "NEW_INSTRUCTION",
  "INSPECTION_SCHEDULED",
  "UNDER_INVESTIGATION",
  "PRELIM_REPORT_SUBMITTED",
  "AWAITING_DOCUMENTS",
  "FINAL_REPORT_DRAFTED",
  "PENDING_SIGNOFF",
  "SETTLED",
  "REPUDIATED",
] as const;

const SORTABLE = ["dateInstructed", "dateOfLoss", "claimReference", "status", "initialReserve", "updatedAt"] as const;

export const listQuery = paginationSchema.extend({
  status: zCsv(z.enum(CLAIM_STATUSES)).optional(),
  /** "open" or "closed" as a shortcut for the status groups. */
  state: z.enum(["open", "closed"]).optional(),
  adjusterId: z.union([z.literal("unassigned"), z.coerce.number().int().positive()]).optional(),
  line: zCsv(z.enum(Object.keys(LINES) as [keyof typeof LINES, ...Array<keyof typeof LINES>])).optional(),
  policyType: zCsv(z.enum(POLICY_TYPES)).optional(),
  insurerId: z.coerce.number().int().positive().optional(),
  from: zDate.optional(),
  to: zDate.optional(),
  q: z.string().trim().max(100).optional(),
  sort: z
    .string()
    .regex(new RegExp(`^-?(${SORTABLE.join("|")})$`), "Unknown sort field.")
    .default("-dateInstructed"),
});
export type ClaimListQuery = z.infer<typeof listQuery>;
export type ClaimFilters = Omit<ClaimListQuery, "page" | "pageSize" | "sort">;

const zState = z.enum(NIGERIAN_STATES, { message: "Pick the state where the loss happened." });

const lossFields = {
  insurerClaimNo: zText(64),
  dateOfLoss: zDate,
  dateInstructed: zDate,
  lossState: zState,
  lossLga: zText(64),
  lossAddress: zRequiredText(500, "Enter the address of the loss."),
  incidentDescription: zRequiredText(10_000, "Describe what happened."),
  initialReserve: zMoney.default("0.00"),
  valueAtRisk: zMoney.nullable().optional(),
  applyAverage: z.boolean().optional(),
};

export const intakeInput = z
  .object({
    policyId: z.coerce.number().int().positive().optional(),
    policy: policyInput.optional(),
    assignedAdjusterId: z.coerce.number().int().positive().nullable().optional(),
    /** Set after the user has seen the possible-duplicate warning. */
    confirmDuplicate: z.boolean().optional(),
    ...lossFields,
  })
  .refine((v) => (v.policyId ? !v.policy : !!v.policy), {
    message: "Choose an existing policy or enter a new one.",
    path: ["policyId"],
  })
  .refine((v) => v.dateOfLoss <= v.dateInstructed, {
    message: "The date of loss can't be after the instruction date.",
    path: ["dateOfLoss"],
  });
export type IntakeInput = z.infer<typeof intakeInput>;

export const claimUpdate = z.object({
  insurerClaimNo: lossFields.insurerClaimNo,
  dateOfLoss: zDate.optional(),
  dateInstructed: zDate.optional(),
  lossState: zState.optional(),
  lossLga: lossFields.lossLga,
  lossAddress: zRequiredText(500).optional(),
  incidentDescription: zRequiredText(10_000).optional(),
  initialReserve: zMoney.optional(),
  valueAtRisk: lossFields.valueAtRisk,
  applyAverage: z.boolean().optional(),
  adjusterFee: zMoney.nullable().optional(),
});
export type ClaimUpdate = z.infer<typeof claimUpdate>;
/** What an assigned adjuster may change; the rest is the principal's. */
export const ADJUSTER_EDITABLE: Array<keyof ClaimUpdate> = ["lossLga", "lossAddress", "incidentDescription", "valueAtRisk", "applyAverage"];

export const assignInput = z.object({ adjusterId: z.coerce.number().int().positive().nullable() });

export const transitionInput = z.object({
  to: z.enum(CLAIM_STATUSES),
  reason: z.string().trim().max(5000).optional(),
  settledAmount: zMoney.optional(),
});

export const deleteInput = z.object({ reason: zRequiredText(1000, "Say why this instruction is being deleted.") });
