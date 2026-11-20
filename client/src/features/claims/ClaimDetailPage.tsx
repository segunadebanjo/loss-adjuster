import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CheckCircle2, CircleDot, Clock, Pencil, Trash2, UserCog, XCircle } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "@/features/auth/AuthContext";
import { claimsApi, queryKeys } from "@/shared/api/claims";
import { errorMessage } from "@/shared/api/client";
import type { ClaimDetail, SlaState } from "@/shared/api/types";
import { formatNaira } from "@/shared/lib/money";
import { POLICY_TYPE_LABEL, formatDate, formatDateTime } from "@/shared/lib/claims";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { Button, Card, ErrorNote, Spinner } from "@/shared/components/ui";
import { ComingSoon } from "@/shared/components/ComingSoon";
import { AssignDialog, DeleteClaimDialog, EditClaimDialog, TransitionDialog } from "./ClaimDialogs";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3 py-2 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words">{children ?? "—"}</dd>
    </div>
  );
}

const SLA_LOOK: Record<SlaState, { label: string; icon: typeof Clock; cls: string }> = {
  MET: { label: "Met", icon: CheckCircle2, cls: "text-emerald-700" },
  MISSED: { label: "Missed", icon: XCircle, cls: "text-red-700" },
  ON_TRACK: { label: "On track", icon: CircleDot, cls: "text-slate-600" },
  AT_RISK: { label: "At risk", icon: AlertTriangle, cls: "text-amber-700" },
  BREACHED: { label: "Overdue", icon: Clock, cls: "text-red-700" },
  NOT_STARTED: { label: "Not started", icon: CircleDot, cls: "text-slate-400" },
  NOT_APPLICABLE: { label: "Not applicable", icon: CircleDot, cls: "text-slate-400" },
};

function excessRule(p: ClaimDetail["policy"]) {
  const fixed = Number(p.excessAmount) > 0 ? formatNaira(p.excessAmount) : null;
  const pct = Number(p.excessPercentage) > 0 ? `${Number(p.excessPercentage)}% of the loss` : null;
  if (fixed && pct) return `${fixed} or ${pct}, whichever is greater`;
  return fixed ?? pct ?? "None";
}

function Overview({ c, staff }: { c: ClaimDetail; staff: boolean }) {
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        <Card title="Loss">
          <dl className="divide-y divide-slate-50">
            <Row label="Date of loss">{formatDate(c.dateOfLoss)}</Row>
            <Row label="Instructed">{formatDate(c.dateInstructed)}</Row>
            <Row label="Insurer's claim no.">{c.insurerClaimNo}</Row>
            <Row label="Location">{[c.lossAddress, c.lossLga, c.lossState].filter(Boolean).join(", ")}</Row>
            <Row label="What happened"><p className="whitespace-pre-line">{c.incidentDescription}</p></Row>
            <Row label="Initial reserve"><span className="tabular-nums">{formatNaira(c.initialReserve)}</span></Row>
            {staff && (
              <>
                <Row label="Value at risk"><span className="tabular-nums">{formatNaira(c.valueAtRisk)}</span></Row>
                <Row label="Average clause">{c.applyAverage ? "Applies" : "Does not apply"}</Row>
              </>
            )}
            {(staff || c.status === "SETTLED") && <Row label="Recommended settlement"><span className="tabular-nums">{formatNaira(c.recommendedSettlement)}</span></Row>}
            {c.settledAmount && <Row label="Settled for"><span className="font-medium tabular-nums">{formatNaira(c.settledAmount)}</span></Row>}
            {staff && <Row label="Adjuster's fee"><span className="tabular-nums">{formatNaira(c.adjusterFee)}</span></Row>}
            {c.repudiationReason && <Row label="Repudiated because">{c.repudiationReason}</Row>}
          </dl>
        </Card>
        <Card title="Policy">
          <dl className="divide-y divide-slate-50">
            <Row label="Insured">{c.policy.insuredName}</Row>
            {staff && <Row label="Contact">{c.policy.insuredContact}</Row>}
            <Row label="Policy no.">{c.policy.policyNumber}</Row>
            <Row label="NAICOM UID"><span className="font-mono text-xs">{c.policy.naicomUid}</span></Row>
            <Row label="Class">{POLICY_TYPE_LABEL[c.policy.policyType]}</Row>
            <Row label="Insurer">{c.policy.insurerName}</Row>
            <Row label="Broker">{c.policy.brokerName ?? "Direct"}</Row>
            <Row label="Sum insured"><span className="tabular-nums">{formatNaira(c.policy.sumInsured)}</span></Row>
            <Row label="Excess">{excessRule(c.policy)}</Row>
            <Row label="Period">{formatDate(c.policy.startDate)} to {formatDate(c.policy.endDate)}</Row>
          </dl>
        </Card>
      </div>
      <div className="space-y-6">
        <Card title="Loss adjuster">
          {c.assignedAdjuster ? (
            <div className="text-sm">
              <p className="font-medium">{c.assignedAdjuster.fullName}{c.assignedAdjuster.ciiQualification ? `, ${c.assignedAdjuster.ciiQualification}` : ""}</p>
              {c.assignedAdjuster.naicomLicenseNo && <p className="text-slate-500">NAICOM licence {c.assignedAdjuster.naicomLicenseNo}</p>}
              <p className="mt-2"><a className="text-brand-700 hover:underline" href={`mailto:${c.assignedAdjuster.email}`}>{c.assignedAdjuster.email}</a></p>
              {c.assignedAdjuster.phone && <p><a className="text-brand-700 hover:underline" href={`tel:${c.assignedAdjuster.phone}`}>{c.assignedAdjuster.phone}</a></p>}
            </div>
          ) : (
            <p className="text-sm text-amber-800">Not assigned yet.</p>
          )}
        </Card>
        <Card title="Turnaround (SLA)">
          <ul className="space-y-3">
            {c.sla.map((s) => {
              const look = SLA_LOOK[s.state];
              return (
                <li key={s.key} className="flex items-start gap-2.5 text-sm">
                  <look.icon className={clsx("mt-0.5 size-4 shrink-0", look.cls)} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p>{s.label}</p>
                    <p className="text-xs text-slate-500">
                      <span className={clsx("font-medium", look.cls)}>{look.label}</span>
                      {s.elapsedDays != null && ` · ${s.elapsedDays} of ${s.targetDays} ${s.businessDays ? "working " : ""}days`}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title="Timeline">
          <ol className="relative space-y-4 border-l border-slate-200 pl-4">
            {[...c.timeline].reverse().map((h) => (
              <li key={h.id} className="text-sm">
                <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-white bg-brand-500" />
                <p className="font-medium">{h.label}</p>
                <p className="text-xs text-slate-500">
                  {formatDateTime(h.changedAt)}
                  {h.changedBy ? ` · ${h.changedBy.fullName}` : ""}
                </p>
                {h.reason && <p className="mt-1 rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-700">{h.reason}</p>}
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}

const STAFF_TABS = [
  { key: "overview", label: "Overview & Policy" },
  { key: "inspection", label: "Site Inspection", phase: 3, text: "Schedule and record site inspections: GPS location, site notes, cause of loss and liability checks." },
  { key: "evidence", label: "Evidence Gallery", phase: 3, text: "Drag-and-drop photos, videos and documents straight to cloud storage." },
  { key: "schedule", label: "Schedule of Loss", phase: 3, text: "Line items with depreciation, betterment and salvage, the average clause and excess, giving the net recommended settlement." },
  { key: "audit", label: "Audit Trail", phase: 4, text: "Every change to this claim: who, what and when." },
] as const;
const INSURER_TABS = [
  { key: "overview", label: "Overview & Policy" },
  { key: "documents", label: "Reports & Fee Notes", phase: 4, text: "Download the approved preliminary and final reports and the fee note." },
] as const;

export function ClaimDetailPage() {
  const id = Number(useParams().id);
  const { user } = useAuth();
  const { data: c, isPending, isError, error } = useQuery({ queryKey: queryKeys.claim(id), queryFn: () => claimsApi.get(id), enabled: Number.isInteger(id) });
  const [tab, setTab] = useState("overview");
  const [dialog, setDialog] = useState<null | "assign" | "edit" | "delete">(null);
  const [move, setMove] = useState<ClaimDetail["allowedTransitions"][number] | null>(null);

  if (isPending) return <Spinner />;
  if (isError || !c) return <ErrorNote message={errorMessage(error, "This claim could not be loaded.")} />;
  const staff = user?.role !== "INSURER";
  const tabs = staff ? STAFF_TABS : INSURER_TABS;
  const current = tabs.find((t) => t.key === tab) ?? tabs[0];

  return (
    <>
      <Link to="/claims" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> Claims
      </Link>
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{c.claimReference}</h1>
            <StatusBadge status={c.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {c.policy.insuredName} · {POLICY_TYPE_LABEL[c.policy.policyType]} · {c.policy.insurerName}
          </p>
        </div>
        {staff && (
          <div className="flex flex-wrap gap-2">
            {c.allowedTransitions.map((t, i) => (
              <Button key={t.to} variant={t.to === "REPUDIATED" ? "secondary" : i === 0 ? "primary" : "secondary"} className={t.to === "REPUDIATED" ? "text-red-700" : ""} onClick={() => setMove(t)}>
                {t.label}
              </Button>
            ))}
            {c.permissions.assign && (
              <Button variant="secondary" onClick={() => setDialog("assign")}>
                <UserCog className="size-4" /> {c.assignedAdjuster ? "Reassign" : "Assign"}
              </Button>
            )}
            {c.permissions.edit && (
              <Button variant="secondary" onClick={() => setDialog("edit")}>
                <Pencil className="size-4" /> Edit
              </Button>
            )}
            {c.permissions.delete && (
              <Button variant="ghost" aria-label="Delete instruction" title="Delete instruction" onClick={() => setDialog("delete")}>
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        )}
      </div>

      {c.warnings.map((w) => (
        <div key={w} className="mb-4 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {w}
        </div>
      ))}

      <div role="tablist" aria-label="Claim sections" className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={current.key === t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              "-mb-px min-h-11 border-b-2 px-3 text-sm font-medium whitespace-nowrap",
              current.key === t.key ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {current.key === "overview" ? (
          <Overview c={c} staff={staff} />
        ) : "phase" in current ? (
          <ComingSoon title="" phase={current.phase}>{current.text}</ComingSoon>
        ) : null}
      </div>

      {move && <TransitionDialog claim={c} move={move} onClose={() => setMove(null)} />}
      {dialog === "assign" && <AssignDialog claim={c} open onClose={() => setDialog(null)} />}
      {dialog === "edit" && <EditClaimDialog claim={c} open onClose={() => setDialog(null)} principal={user?.role === "ADMIN"} />}
      {dialog === "delete" && <DeleteClaimDialog claim={c} open onClose={() => setDialog(null)} />}
    </>
  );
}
