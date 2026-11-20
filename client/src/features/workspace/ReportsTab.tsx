import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, Eye, FilePlus2, RotateCcw, Send, ShieldCheck } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "@/features/auth/AuthContext";
import { queryKeys } from "@/shared/api/claims";
import { errorMessage, fieldErrors } from "@/shared/api/client";
import { documentKeys, documentsApi, openPdf } from "@/shared/api/documents";
import type { ClaimDetail, Report, ReportSectionDef, ReportStatus, ReportType } from "@/shared/api/types";
import { formatDateTime } from "@/shared/lib/claims";
import { Button, Card, ErrorNote, Field, Modal, Spinner, Textarea } from "@/shared/components/ui";

const TYPE_LABEL: Record<ReportType, string> = { PRELIMINARY: "Preliminary report", FINAL: "Final loss adjustment report" };
const STATUS_LOOK: Record<ReportStatus, { label: string; cls: string }> = {
  DRAFT: { label: "Draft", cls: "bg-slate-100 text-slate-700 ring-slate-200" },
  SUBMITTED: { label: "Awaiting sign-off", cls: "bg-orange-50 text-orange-900 ring-orange-200" },
  RETURNED: { label: "Returned", cls: "bg-red-50 text-red-800 ring-red-200" },
  APPROVED: { label: "Signed off", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
};

export function ReportBadge({ status }: { status: ReportStatus }) {
  const l = STATUS_LOOK[status];
  return <span className={clsx("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", l.cls)}>{l.label}</span>;
}

function useRefresh(claimId: number) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: documentKeys.reports(claimId) });
    // Submitting, signing off and returning move the claim.
    void qc.invalidateQueries({ queryKey: queryKeys.claim(claimId), exact: true });
    void qc.invalidateQueries({ queryKey: ["claims", "detail", claimId, "valuation"] });
    void qc.invalidateQueries({ queryKey: queryKeys.kpis });
  };
}

function PdfButtons({ claimId, report, claimRef }: { claimId: number; report: Report; claimRef: string }) {
  const [err, setErr] = useState<string | null>(null);
  const url = documentsApi.reportPdfUrl(claimId, report.id);
  const name = `${report.type === "FINAL" ? "Final" : "Preliminary"} report ${claimRef}${report.version > 1 ? ` v${report.version}` : ""}${report.status === "APPROVED" ? "" : " DRAFT"}.pdf`;
  const run = (mode: "open" | "download") => openPdf(url, name, mode).catch((e) => setErr(errorMessage(e)));
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => void run("open")}><Eye className="size-3.5" /> {report.status === "APPROVED" ? "View PDF" : "Preview PDF"}</Button>
      {report.status === "APPROVED" && <Button variant="secondary" size="sm" onClick={() => void run("download")}><Download className="size-3.5" /> Download</Button>}
      {err && <p className="w-full text-xs text-red-700">{err}</p>}
    </>
  );
}

function Editor({ claimId, report, sections, canEdit }: { claimId: number; report: Report; sections: ReportSectionDef[]; canEdit: boolean }) {
  const refresh = useRefresh(claimId);
  const [text, setText] = useState<Record<string, string>>(() => ({ ...report.body?.sections }));
  const dirty = sections.some((s) => (text[s.key] ?? "") !== (report.body?.sections[s.key] ?? ""));
  const save = useMutation({ mutationFn: () => documentsApi.saveReport(claimId, report.id, text), onSuccess: refresh });
  const submit = useMutation({
    mutationFn: async () => {
      if (dirty) await documentsApi.saveReport(claimId, report.id, text);
      return documentsApi.submitReport(claimId, report.id);
    },
    onSuccess: refresh,
  });
  const missing = fieldErrors(submit.error);
  return (
    <div className="space-y-4">
      {report.status === "RETURNED" && report.returnReason && (
        <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <RotateCcw className="mt-0.5 size-4 shrink-0" />
          <div><p className="font-medium">Returned by {report.reviewedBy?.fullName}</p><p>{report.returnReason}</p></div>
        </div>
      )}
      {sections.map((s) => (
        <Field key={s.key} label={s.title} required={s.required} hint={s.hint} error={missing[s.key]}>
          {(id, d) => <Textarea id={id} aria-describedby={d} rows={s.key === "circumstances" || s.key === "quantum" ? 5 : 3} value={text[s.key] ?? ""} disabled={!canEdit} onChange={(e) => setText((t) => ({ ...t, [s.key]: e.target.value }))} aria-invalid={!!missing[s.key]} />}
        </Field>
      ))}
      {save.isError && <ErrorNote message={errorMessage(save.error)} />}
      {submit.isError && <ErrorNote message={errorMessage(submit.error)} />}
      {canEdit && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save draft</Button>
          <Button loading={submit.isPending} onClick={() => submit.mutate()}><Send className="size-4" /> Submit for sign-off</Button>
        </div>
      )}
    </div>
  );
}

function SignOff({ claimId, report }: { claimId: number; report: Report }) {
  const refresh = useRefresh(claimId);
  const { user } = useAuth();
  const own = report.draftedBy.id === user?.id;
  const [dialog, setDialog] = useState<null | "approve" | "return">(null);
  const [text, setText] = useState("");
  const approve = useMutation({ mutationFn: () => documentsApi.approveReport(claimId, report.id, text || undefined), onSuccess: () => { refresh(); setDialog(null); } });
  const ret = useMutation({ mutationFn: () => documentsApi.returnReport(claimId, report.id, text), onSuccess: () => { refresh(); setDialog(null); } });
  const m = dialog === "approve" ? approve : ret;
  return (
    <>
      <Button onClick={() => { setText(""); setDialog("approve"); }}><ShieldCheck className="size-4" /> Sign off</Button>
      <Button variant="secondary" onClick={() => { setText(""); setDialog("return"); }}><RotateCcw className="size-4" /> Return</Button>
      <Modal
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={dialog === "approve" ? "Sign off this report?" : "Return to the adjuster"}
        footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate()}>{dialog === "approve" ? "Sign off" : "Return"}</Button></>}
      >
        <div className="space-y-4 text-sm">
          {dialog === "approve" ? (
            <p className="text-slate-600">
              The PDF is generated now, with your name as approver, and frozen: it can't be changed afterwards. The insurer can download it straight away.
              {report.type === "PRELIMINARY" ? " The claim moves to \"Preliminary report submitted\"." : " The claim can then be marked settled."}
            </p>
          ) : (
            <p className="text-slate-600">The adjuster can edit and resubmit it.{report.type === "FINAL" ? " The claim goes back to \"Final report drafted\" and the schedule of loss unlocks." : ""}</p>
          )}
          {m.isError && <ErrorNote message={errorMessage(m.error)} />}
          {(dialog === "return" || own) && (
            <Field label={dialog === "return" ? "What needs to change" : "Why you are signing off your own report"} required hint={dialog === "approve" ? "Allowed only when no other principal adjuster is active. Recorded on the report." : undefined}>
              {(id, d) => <Textarea id={id} aria-describedby={d} rows={3} value={text} onChange={(e) => setText(e.target.value)} />}
            </Field>
          )}
        </div>
      </Modal>
    </>
  );
}

function ReportCard({ claim, type, reports, sections, canStart }: { claim: ClaimDetail; type: ReportType; reports: Report[]; sections: ReportSectionDef[]; canStart: boolean }) {
  const { user } = useAuth();
  const refresh = useRefresh(claim.id);
  const start = useMutation({ mutationFn: () => documentsApi.startReport(claim.id, type), onSuccess: refresh });
  const current = reports[0];
  const older = reports.slice(1);
  const editable = !!current && (current.status === "DRAFT" || current.status === "RETURNED") && claim.permissions.edit;
  return (
    <Card
      title={<div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">{TYPE_LABEL[type]}</h2>{current && <ReportBadge status={current.status} />}{current && current.version > 1 && <span className="text-xs text-slate-500">version {current.version}</span>}</div>}
      actions={canStart && <Button size="sm" loading={start.isPending} onClick={() => start.mutate()}><FilePlus2 className="size-3.5" /> {current ? "Start a new version" : "Start report"}</Button>}
    >
      {start.isError && <ErrorNote message={errorMessage(start.error)} className="mb-4" />}
      {!current ? (
        <p className="text-sm text-slate-500">
          {canStart ? "Not started. The draft is filled in from what the claim already records." : type === "PRELIMINARY" ? "Written once the site inspection is scheduled or done." : "Written after the preliminary report is signed off."}
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Drafted by {current.draftedBy.fullName}
            {current.submittedAt && ` · submitted ${formatDateTime(current.submittedAt)}`}
            {current.status === "APPROVED" && current.reviewedBy && ` · signed off by ${current.reviewedBy.fullName} on ${formatDateTime(current.reviewedAt)}`}
          </p>
          {current.status === "APPROVED" ? (
            <div className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <p>Signed off and available to the insurer.</p>
                {current.selfApprovalNote && <p className="mt-1 text-xs">Signed off by its author: {current.selfApprovalNote}</p>}
                <p className="mt-1 truncate font-mono text-[11px] text-emerald-900/70" title={current.pdfSha256 ?? ""}>SHA-256 {current.pdfSha256}</p>
              </div>
            </div>
          ) : current.status === "SUBMITTED" ? (
            <div className="space-y-3">
              <p className="rounded-lg bg-orange-50 p-3 text-sm text-orange-900">With the principal adjuster for sign-off. The text and figures are frozen as submitted.</p>
              <details className="text-sm">
                <summary className="cursor-pointer text-slate-600">Read the submitted text</summary>
                <div className="mt-3 space-y-3">
                  {sections.filter((s) => current.body?.sections[s.key]).map((s) => (
                    <div key={s.key}><p className="font-medium">{s.title}</p><p className="whitespace-pre-line text-slate-700">{current.body?.sections[s.key]}</p></div>
                  ))}
                </div>
              </details>
            </div>
          ) : (
            <Editor key={`${current.id}-${current.updatedAt}`} claimId={claim.id} report={current} sections={sections} canEdit={editable} />
          )}
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <PdfButtons claimId={claim.id} report={current} claimRef={claim.claimReference} />
            {current.status === "SUBMITTED" && user?.role === "ADMIN" && <SignOff claimId={claim.id} report={current} />}
          </div>
          {older.length > 0 && (
            <div className="border-t border-slate-100 pt-3 text-xs text-slate-500">
              Earlier versions:{" "}
              {older.map((r) => (
                <span key={r.id} className="mr-3">v{r.version} <ReportBadge status={r.status} /></span>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function ReportsTab({ claim }: { claim: ClaimDetail }) {
  const { data, isPending, isError, error } = useQuery({ queryKey: documentKeys.reports(claim.id), queryFn: () => documentsApi.reports(claim.id) });
  if (isPending) return <Spinner />;
  if (isError || !data) return <ErrorNote message={errorMessage(error)} />;
  return (
    <div className="space-y-6">
      {(["PRELIMINARY", "FINAL"] as const).map((t) => (
        <ReportCard key={t} claim={claim} type={t} reports={data.data.filter((r) => r.type === t)} sections={data.sections[t]} canStart={data.canStart[t]} />
      ))}
    </div>
  );
}
