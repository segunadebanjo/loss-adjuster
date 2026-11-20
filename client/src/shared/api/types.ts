export type Role = "ADMIN" | "ADJUSTER" | "INSURER";

export interface User {
  id: number;
  fullName: string;
  email: string;
  role: Role;
  phone: string | null;
  naicomLicenseNo: string | null;
  ciiQualification: string | null;
  organisation: { id: number; name: string; type: "INSURER" | "BROKER" } | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: Array<{ path: string; message: string }> | unknown };
}

export type ClaimStatus =
  | "NEW_INSTRUCTION"
  | "INSPECTION_SCHEDULED"
  | "UNDER_INVESTIGATION"
  | "PRELIM_REPORT_SUBMITTED"
  | "AWAITING_DOCUMENTS"
  | "FINAL_REPORT_DRAFTED"
  | "PENDING_SIGNOFF"
  | "SETTLED"
  | "REPUDIATED";

export type PolicyType = "MOTOR" | "PROPERTY_FIRE" | "MARINE_CARGO" | "OIL_AND_GAS" | "ENGINEERING_CAR" | "GENERAL_ACCIDENT";
export type Line = "MOTOR" | "MARINE" | "OIL_AND_GAS" | "PROPERTY" | "GENERAL_ACCIDENT";

export interface Policy {
  id: number;
  policyNumber: string;
  naicomUid: string;
  insurerOrgId: number;
  brokerOrgId: number | null;
  insurerName: string;
  brokerName: string | null;
  insuredName: string;
  insuredContact: string | null;
  policyType: PolicyType;
  sumInsured: string;
  excessAmount: string;
  excessPercentage: string;
  startDate: string;
  endDate: string;
  /** The lead insurer's share; 100 unless co-insured. */
  leadSharePercent: string;
  coInsurers: Array<{ organisationId: number; insurerName: string; sharePercent: string }>;
}

export interface ClaimListItem {
  id: number;
  claimReference: string;
  insurerClaimNo: string | null;
  status: ClaimStatus;
  statusLabel: string;
  dateOfLoss: string;
  dateInstructed: string;
  lossState: string;
  lossLga: string | null;
  policy: { id: number; policyNumber: string; insuredName: string; policyType: PolicyType; insurerName: string; brokerName: string | null };
  assignedAdjuster: { id: number; fullName: string } | null;
  initialReserve: string;
  recommendedSettlement: string | null;
  settledAmount: string | null;
  adjusterFee?: string | null;
  daysOpen: number;
}

export interface Paged<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

export type SlaState = "NOT_STARTED" | "ON_TRACK" | "AT_RISK" | "BREACHED" | "MET" | "MISSED" | "NOT_APPLICABLE";
export interface SlaClock {
  key: string;
  label: string;
  targetDays: number;
  businessDays: boolean;
  startedAt: string | null;
  completedAt: string | null;
  elapsedDays: number | null;
  state: SlaState;
}

export interface ClaimDetail extends Omit<ClaimListItem, "policy" | "assignedAdjuster" | "daysOpen"> {
  lossAddress: string;
  incidentDescription: string;
  valueAtRisk?: string | null;
  applyAverage?: boolean;
  repudiationReason: string | null;
  coAdjuster?: { firm: string; naicomNo: string | null; splitPercent: string | null } | null;
  closedAt: string | null;
  createdAt: string;
  policy: Policy;
  assignedAdjuster: { id: number; fullName: string; email: string; phone: string | null; naicomLicenseNo: string | null; ciiQualification: string | null } | null;
  timeline: Array<{ id: number; fromStatus: ClaimStatus | null; toStatus: ClaimStatus; label: string; changedAt: string; changedBy?: { id: number; fullName: string } | null; reason: string | null }>;
  inspections: { total: number; completed: number; nextScheduled: string | null };
  sla: SlaClock[];
  warnings: string[];
  allowedTransitions: Array<{ to: ClaimStatus; label: string; reasonRequired: boolean; settledAmountRequired: boolean }>;
  permissions: { edit: boolean; assign: boolean; delete: boolean };
}

export interface ClaimOptions {
  statuses: Array<{ value: ClaimStatus; label: string }>;
  lines: Array<{ value: Line; label: string }>;
  policyTypes: Array<{ value: PolicyType; label: string }>;
  states: string[];
  adjusters: Array<{ id: number; fullName: string; ciiQualification: string | null }>;
  insurers: Array<{ id: number; name: string }>;
  brokers: Array<{ id: number; name: string }>;
}

export interface DashboardKpis {
  activeInstructions: number;
  closedClaims: number;
  unassigned: number;
  pendingInspections: { total: number; unscheduled: number; overdue: number };
  openReserve: string;
  claimedVsAdjusted: { claimsCompared: number; totalClaimed: string; totalAdjusted: string; savings: string; savingsPercent: number | null };
  sla: Array<{ key: string; label: string; targetDays: number; businessDays: boolean; counts: Record<SlaState, number>; onTimeRate: number | null }>;
  byStatus: Array<{ status: ClaimStatus; label: string; count: number }>;
  byLine: Array<{ line: Line; label: string; count: number; open: number; openReserve: string }>;
  workload: Array<{ adjusterId: number; fullName: string; open: number }>;
}

export interface Organisation {
  id: number;
  name: string;
  type: "INSURER" | "BROKER";
  naicomLicenceNo: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  userCount: number;
  policyCount: number;
}

export interface AdminUser {
  id: number;
  fullName: string;
  email: string;
  role: Role;
  phone: string | null;
  naicomLicenseNo: string | null;
  ciiQualification: string | null;
  organisationId: number | null;
  organisation: { id: number; name: string; type: string } | null;
  isActive: boolean;
  lastLoginAt: string | null;
  openClaims: number;
}

export interface Inspection {
  id: number;
  adjuster: { id: number; fullName: string };
  scheduledDate: string;
  completedDate: string | null;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  gpsOutsideNigeria: boolean;
  siteNotes: string | null;
  causeOfLossVerified: boolean;
  policyLiabilityConfirmed: boolean;
  thirdPartyInvolvement: boolean;
  createdAt: string;
}

export interface EvidenceFile {
  id: number;
  fileName: string;
  fileType: "PHOTO" | "DOCUMENT" | "INVOICE" | "VIDEO";
  category: string;
  caption: string | null;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  visibleToInsurer: boolean;
  uploadedBy: { id: number; fullName: string };
  createdAt: string;
  url: string;
  thumbnailUrl: string | null;
  downloadUrl: string;
}

export interface ValuationItem {
  id: number;
  itemDescription: string;
  category: string;
  claimedAmount: string;
  assessedAmount: string;
  depreciationAmount: string;
  bettermentDeduction: string;
  netPayable: string;
  /** Depreciation + betterment, worked out by the server. */
  deductions: string;
  adjusterNotes: string | null;
  sortOrder: number;
}

export interface Settlement {
  lineCount: number;
  totalClaimed: string;
  totalAssessed: string;
  totalDepreciation: string;
  totalBetterment: string;
  salvage: string;
  grossLoss: string;
  average: { applied: boolean; ratioPercent: string | null; reduction: string; reason: string };
  lossAfterAverage: string;
  excess: { fixed: string; percentage: string; percentageAmount: string; applied: string; basis: "FIXED" | "PERCENTAGE" | "NONE" };
  netBeforeCap: string;
  cappedAtSumInsured: boolean;
  netRecommended: string;
  savings: string;
  warnings: string[];
}

export interface Valuation {
  items: ValuationItem[];
  settlement: Settlement;
  totalDeductions: string;
  basis: { sumInsured: string; valueAtRisk: string | null; applyAverage: boolean; excessAmount: string; excessPercentage: string };
  editable: boolean;
  categories: string[];
}

export type ReportType = "PRELIMINARY" | "FINAL";
export type ReportStatus = "DRAFT" | "SUBMITTED" | "RETURNED" | "APPROVED";
export interface ReportSectionDef {
  key: string;
  title: string;
  required: boolean;
  hint: string;
}
export interface Report {
  id: number;
  type: ReportType;
  version: number;
  status: ReportStatus;
  draftedBy: { id: number; fullName: string };
  submittedAt: string | null;
  reviewedBy: { id: number; fullName: string } | null;
  reviewedAt: string | null;
  pdfSha256: string | null;
  createdAt: string;
  updatedAt: string;
  body?: { sections: Record<string, string> };
  returnReason?: string | null;
  selfApprovalNote?: string | null;
  /** Sign-offs the approval matrix asks for, fixed when the report was submitted. */
  requiredApprovals: number;
  approvalTier: string | null;
  approvals: Array<{ approvedBy: { id: number; fullName: string }; at: string; note?: string | null }>;
  /** On an approve response: false while more sign-offs are needed. */
  signOffComplete?: boolean;
}

export interface ApprovalTier {
  label: string;
  minAmount: string;
  requiredApprovals: number;
}
export interface ReportList {
  data: Report[];
  sections: Record<ReportType, ReportSectionDef[]>;
  canStart: Record<ReportType, boolean>;
}

export type FeeNoteStatus = "DRAFT" | "ISSUED" | "PAID" | "CANCELLED";
export interface FeeNote {
  id: number;
  feeNoteNo: string | null;
  status: FeeNoteStatus;
  professionalFee: string;
  expenses: Array<{ description: string; amount: string }>;
  vatRate: string;
  whtRate: string;
  grossAmount: string;
  vatAmount: string;
  invoiceTotal: string;
  whtAmount: string;
  netPayable: string;
  notes: string | null;
  issuedAt: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  cancelReason: string | null;
  pdfSha256: string | null;
  createdAt: string;
}

export interface AuditEntry {
  id: number;
  action: string;
  entityType: string;
  entityId: number | null;
  user: { id: number; fullName: string } | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}
