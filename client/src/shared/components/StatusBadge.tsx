import clsx from "clsx";
import type { ClaimStatus } from "@/shared/api/types";
import { STATUS_LABEL } from "@/shared/lib/claims";

const TONE: Record<ClaimStatus, string> = {
  NEW_INSTRUCTION: "bg-sky-50 text-sky-800 ring-sky-200",
  INSPECTION_SCHEDULED: "bg-indigo-50 text-indigo-800 ring-indigo-200",
  UNDER_INVESTIGATION: "bg-violet-50 text-violet-800 ring-violet-200",
  PRELIM_REPORT_SUBMITTED: "bg-teal-50 text-teal-800 ring-teal-200",
  AWAITING_DOCUMENTS: "bg-amber-50 text-amber-900 ring-amber-200",
  FINAL_REPORT_DRAFTED: "bg-cyan-50 text-cyan-800 ring-cyan-200",
  PENDING_SIGNOFF: "bg-orange-50 text-orange-900 ring-orange-200",
  SETTLED: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  REPUDIATED: "bg-red-50 text-red-800 ring-red-200",
};

export function StatusBadge({ status, className }: { status: ClaimStatus; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset", TONE[status], className)}>
      {STATUS_LABEL[status]}
    </span>
  );
}
