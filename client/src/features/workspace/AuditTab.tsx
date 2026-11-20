import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "@/shared/api/client";
import { documentKeys, documentsApi } from "@/shared/api/documents";
import type { AuditEntry, ClaimDetail } from "@/shared/api/types";
import { STATUS_LABEL, formatDateTime } from "@/shared/lib/claims";
import { formatNaira } from "@/shared/lib/money";
import { Card, EmptyState, ErrorNote, Spinner } from "@/shared/components/ui";

const ACTION_LABEL: Record<string, string> = {
  CLAIM_INSTRUCTED: "Instruction logged",
  CLAIM_UPDATED: "Claim details changed",
  CLAIM_ASSIGNED: "Adjuster assigned",
  CLAIM_STATUS_CHANGED: "Status changed",
  CLAIM_DELETED: "Instruction deleted",
  POLICY_CREATED: "Policy added",
  POLICY_UPDATED: "Policy changed",
  INSPECTION_SCHEDULED: "Inspection scheduled",
  INSPECTION_UPDATED: "Inspection updated",
  INSPECTION_COMPLETED: "Inspection recorded",
  INSPECTION_CANCELLED: "Inspection cancelled",
  EVIDENCE_UPLOADED: "Evidence uploaded",
  EVIDENCE_UPDATED: "Evidence details changed",
  EVIDENCE_REMOVED: "Evidence removed",
  VALUATION_ITEM_ADDED: "Schedule line added",
  VALUATION_ITEM_UPDATED: "Schedule line changed",
  VALUATION_ITEM_DELETED: "Schedule line deleted",
  REPORT_DRAFTED: "Report started",
  REPORT_EDITED: "Report edited",
  REPORT_SUBMITTED: "Report submitted for sign-off",
  REPORT_APPROVED: "Report signed off",
  REPORT_RETURNED: "Report returned",
  FEE_NOTE_DRAFTED: "Fee note drafted",
  FEE_NOTE_UPDATED: "Fee note changed",
  FEE_NOTE_ISSUED: "Fee note issued",
  FEE_NOTE_PAID: "Fee note paid",
  FEE_NOTE_CANCELLED: "Fee note cancelled",
};

const FIELD_LABEL: Record<string, string> = {
  assignedAdjusterId: "adjuster", lossLga: "LGA", lossAddress: "address", incidentDescription: "description", initialReserve: "reserve",
  valueAtRisk: "value at risk", applyAverage: "average clause", insurerClaimNo: "insurer's claim no.", dateOfLoss: "date of loss",
  dateInstructed: "date instructed", lossState: "state", sumInsured: "sum insured", excessAmount: "excess (fixed)", excessPercentage: "excess (%)",
  completedDate: "completed", scheduledDate: "scheduled", siteNotes: "site notes", visibleToInsurer: "shared with insurer",
};

const DETAIL_LABEL: Record<string, string> = {
  pdfSha256: "PDF SHA-256", feeNoteNo: "Fee note", paidOn: "Paid on", reference: "Reference", netPayable: "Net payable",
  professionalFee: "Professional fee", netRecommended: "Net recommended", settledAmount: "Settled for", reason: "Reason",
  type: "Report", version: "Version", claimReference: "Claim", policyNumber: "Policy", naicomUid: "NAICOM UID",
  scheduledDate: "Scheduled", adjusterId: "Adjuster id", fileName: "File", sha256: "SHA-256", selfApprovalNote: "Self sign-off note",
};
const MONEY_KEYS = new Set(["netPayable", "professionalFee", "netRecommended", "settledAmount"]);

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "blank" : typeof v === "string" && v in STATUS_LABEL ? STATUS_LABEL[v as keyof typeof STATUS_LABEL] : String(v));

function Details({ e }: { e: AuditEntry }) {
  const d = e.details ?? {};
  const changes = d.changes as Record<string, { from: unknown; to: unknown }> | undefined;
  const lines: string[] = [];
  if (changes) for (const [k, v] of Object.entries(changes)) lines.push(`${FIELD_LABEL[k] ?? k}: ${show(v.from)} → ${show(v.to)}`);
  for (const [k, v] of Object.entries(d)) {
    if (k === "changes" || v === null || v === undefined || typeof v === "object") continue;
    const value = MONEY_KEYS.has(k) ? formatNaira(String(v)) : k === "type" ? (v === "FINAL" ? "final" : "preliminary") : String(v);
    lines.push(`${DETAIL_LABEL[k] ?? k}: ${value}`);
  }
  if (Array.isArray(d.files)) lines.push(`${d.files.length} file(s): ${(d.files as Array<{ fileName: string }>).map((f) => f.fileName).join(", ")}`);
  if (!lines.length) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
      {lines.map((l) => <li key={l} className="break-words">{l}</li>)}
    </ul>
  );
}

export function AuditTab({ claim }: { claim: ClaimDetail }) {
  const { data, isPending, isError, error } = useQuery({ queryKey: documentKeys.audit(claim.id), queryFn: () => documentsApi.audit(claim.id) });
  if (isPending) return <Spinner />;
  if (isError || !data) return <ErrorNote message={errorMessage(error)} />;
  return (
    <Card title={`Audit trail (${data.length})`} bodyClassName="p-0">
      {data.length === 0 ? <EmptyState title="Nothing recorded yet" /> : (
        <ol className="divide-y divide-slate-100">
          {data.map((e) => (
            <li key={e.id} className="grid gap-1 px-5 py-3 text-sm sm:grid-cols-[11rem_1fr]">
              <p className="text-xs text-slate-500 tabular-nums">{formatDateTime(e.createdAt)}</p>
              <div className="min-w-0">
                <p><span className="font-medium">{ACTION_LABEL[e.action] ?? e.action}</span> <span className="text-slate-500">by {e.user?.fullName ?? "the system"}</span></p>
                <Details e={e} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
