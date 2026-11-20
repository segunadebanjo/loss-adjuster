import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCircle2, Download, Eye, Plus, Receipt, Send, Trash2 } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "@/features/auth/AuthContext";
import { queryKeys } from "@/shared/api/claims";
import { errorMessage, fieldErrors } from "@/shared/api/client";
import { documentKeys, documentsApi, openPdf } from "@/shared/api/documents";
import type { ClaimDetail, FeeNote, FeeNoteStatus } from "@/shared/api/types";
import { formatNaira } from "@/shared/lib/money";
import { formatDate, formatDateTime, moneyToApi, moneyToInput, todayLagos } from "@/shared/lib/claims";
import { Button, Card, EmptyState, ErrorNote, Field, Input, Modal, MoneyInput, Spinner, Textarea } from "@/shared/components/ui";

const LOOK: Record<FeeNoteStatus, { label: string; cls: string }> = {
  DRAFT: { label: "Draft", cls: "bg-slate-100 text-slate-700 ring-slate-200" },
  ISSUED: { label: "Issued", cls: "bg-sky-50 text-sky-800 ring-sky-200" },
  PAID: { label: "Paid", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  CANCELLED: { label: "Cancelled", cls: "bg-red-50 text-red-800 ring-red-200" },
};

function useRefresh(claimId: number) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: documentKeys.feeNotes(claimId) });
    void qc.invalidateQueries({ queryKey: queryKeys.claim(claimId), exact: true });
  };
}

function FeeNoteDialog({ claimId, note, rates, onClose }: { claimId: number; note: FeeNote | null; rates: { vat: string; wht: string }; onClose: () => void }) {
  const refresh = useRefresh(claimId);
  const [fee, setFee] = useState(moneyToInput(note?.professionalFee));
  const [expenses, setExpenses] = useState(note?.expenses.map((e) => ({ description: e.description, amount: moneyToInput(e.amount) })) ?? []);
  const [notes, setNotes] = useState(note?.notes ?? "");
  const m = useMutation({
    mutationFn: () => {
      const body = { professionalFee: moneyToApi(fee) ?? "", expenses: expenses.map((e) => ({ description: e.description, amount: moneyToApi(e.amount) ?? "" })), notes };
      return note ? documentsApi.updateFeeNote(claimId, note.id, body) : documentsApi.createFeeNote(claimId, body);
    },
    onSuccess: () => { refresh(); onClose(); },
  });
  const errs = fieldErrors(m.error);
  return (
    <Modal open onClose={onClose} size="lg" title={note ? "Edit draft fee note" : "New fee note"} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Save draft</Button></>}>
      <div className="space-y-4">
        {m.isError && !Object.keys(errs).length && <ErrorNote message={errorMessage(m.error)} />}
        <Field label="Professional fee" required error={errs.professionalFee}>{(id) => <MoneyInput id={id} value={fee} onChange={setFee} />}</Field>
        <div>
          <p className="text-sm font-medium text-slate-700">Expenses</p>
          <ul className="mt-2 space-y-2">
            {expenses.map((e, i) => (
              <li key={i} className="flex items-start gap-2">
                <Input aria-label={`Expense ${i + 1} description`} value={e.description} placeholder="e.g. Travel to Port Harcourt" onChange={(ev) => setExpenses((x) => x.map((y, j) => (j === i ? { ...y, description: ev.target.value } : y)))} />
                <div className="w-44 shrink-0"><MoneyInput aria-label={`Expense ${i + 1} amount`} value={e.amount} onChange={(v) => setExpenses((x) => x.map((y, j) => (j === i ? { ...y, amount: v } : y)))} /></div>
                <button type="button" aria-label="Remove expense" onClick={() => setExpenses((x) => x.filter((_, j) => j !== i))} className="grid size-10 shrink-0 place-items-center rounded text-slate-400 hover:bg-slate-100"><Trash2 className="size-4" /></button>
              </li>
            ))}
          </ul>
          {Object.entries(errs).filter(([k]) => k.startsWith("expenses")).map(([k, v]) => <p key={k} className="mt-1 text-xs text-red-700">{v}</p>)}
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setExpenses((x) => [...x, { description: "", amount: "" }])}><Plus className="size-3.5" /> Add expense</Button>
        </div>
        <Field label="Note on the fee note" hint="Optional, printed at the bottom.">{(id, d) => <Textarea id={id} aria-describedby={d} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        <p className="text-xs text-slate-500">VAT at {Number(rates.vat)}% is charged on the fee and expenses; withholding tax at {Number(rates.wht)}% of the fee is deducted. The figures are worked out when you save.</p>
      </div>
    </Modal>
  );
}

function Figures({ f }: { f: FeeNote }) {
  const row = (label: string, value: string, opts: { minus?: boolean; strong?: boolean } = {}) => (
    <div className={clsx("flex justify-between gap-3 py-1", opts.strong && "border-t border-slate-200 pt-2 font-semibold")}>
      <span>{label}</span><span className="tabular-nums">{opts.minus ? `(${formatNaira(value)})` : formatNaira(value)}</span>
    </div>
  );
  return (
    <div className="text-sm">
      {row("Professional fee", f.professionalFee)}
      {f.expenses.map((e, i) => <div key={i}>{row(`Expense: ${e.description}`, e.amount)}</div>)}
      {row(`VAT at ${Number(f.vatRate)}%`, f.vatAmount)}
      {row("Total due (incl. VAT)", f.invoiceTotal, { strong: true })}
      {row(`Less WHT at ${Number(f.whtRate)}% of the fee`, f.whtAmount, { minus: true })}
      {row("Net payable by the insurer", f.netPayable, { strong: true })}
    </div>
  );
}

function ActionDialog({ claimId, note, kind, onClose }: { claimId: number; note: FeeNote; kind: "issue" | "paid" | "cancel"; onClose: () => void }) {
  const refresh = useRefresh(claimId);
  const [paidOn, setPaidOn] = useState(todayLagos());
  const [text, setText] = useState("");
  const m = useMutation({
    mutationFn: () =>
      kind === "issue" ? documentsApi.issueFeeNote(claimId, note.id)
      : kind === "paid" ? documentsApi.markPaid(claimId, note.id, { paidOn, reference: text })
      : documentsApi.cancelFeeNote(claimId, note.id, text),
    onSuccess: () => { refresh(); onClose(); },
  });
  const titles = { issue: "Issue this fee note?", paid: "Record payment", cancel: "Cancel this fee note?" };
  return (
    <Modal open onClose={onClose} title={titles[kind]} footer={<><Button variant="secondary" onClick={onClose}>Back</Button><Button variant={kind === "cancel" ? "danger" : "primary"} loading={m.isPending} onClick={() => m.mutate()}>{kind === "issue" ? "Issue" : kind === "paid" ? "Save" : "Cancel fee note"}</Button></>}>
      <div className="space-y-4 text-sm">
        {kind === "issue" && <p className="text-slate-600">It gets the next FN number and a frozen PDF, the insurer can download it, and it can no longer be edited (only cancelled). Net payable {formatNaira(note.netPayable)}.</p>}
        {kind === "cancel" && <p className="text-slate-600">{note.feeNoteNo ? `${note.feeNoteNo} keeps its number and PDF but no longer counts towards the claim's fee.` : "The draft will be cancelled."}</p>}
        {m.isError && <ErrorNote message={errorMessage(m.error)} />}
        {kind === "paid" && <Field label="Paid on" required>{(id) => <Input id={id} type="date" value={paidOn} max={todayLagos()} onChange={(e) => setPaidOn(e.target.value)} />}</Field>}
        {kind !== "issue" && <Field label={kind === "paid" ? "Payment reference" : "Reason"} required={kind === "cancel"}>{(id) => <Input id={id} value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === "paid" ? "e.g. NIP transfer reference" : ""} />}</Field>}
      </div>
    </Modal>
  );
}

export function FeeNotesTab({ claim, readOnly }: { claim: ClaimDetail; readOnly?: boolean }) {
  const { user } = useAuth();
  const { data, isPending, isError, error } = useQuery({ queryKey: documentKeys.feeNotes(claim.id), queryFn: () => documentsApi.feeNotes(claim.id) });
  const [editing, setEditing] = useState<FeeNote | null | "new">(null);
  const [action, setAction] = useState<{ note: FeeNote; kind: "issue" | "paid" | "cancel" } | null>(null);
  const [pdfErr, setPdfErr] = useState<string | null>(null);
  const principal = user?.role === "ADMIN" && !readOnly;
  if (isPending) return <Spinner />;
  if (isError || !data) return <ErrorNote message={errorMessage(error)} />;
  const pdf = (n: FeeNote, mode: "open" | "download") =>
    openPdf(documentsApi.feeNotePdfUrl(claim.id, n.id), `${n.feeNoteNo ?? "Fee note DRAFT"}.pdf`, mode).catch((e) => setPdfErr(errorMessage(e)));
  // The claim's current fee note: the latest issued one, else (staff) the latest draft as a preview.
  const current = data.data.find((n) => n.status === "ISSUED" || n.status === "PAID") ?? data.data.find((n) => n.status === "DRAFT");
  const downloadCurrent = () =>
    openPdf(documentsApi.currentFeeNotePdfUrl(claim.id), `${current?.feeNoteNo ?? "Fee note DRAFT"}.pdf`, "download").catch((e) => setPdfErr(errorMessage(e)));

  return (
    <div className="space-y-4">
      {(principal || current) && (
        <div className="flex flex-wrap justify-end gap-2">
          {current && <Button variant="secondary" onClick={() => void downloadCurrent()}><Download className="size-4" /> Download Fee Note PDF{current.status === "DRAFT" ? " (draft)" : ""}</Button>}
          {principal && <Button onClick={() => setEditing("new")}><Plus className="size-4" /> New fee note</Button>}
        </div>
      )}
      {claim.policy.coInsurers?.length > 0 && (
        <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          Co-insured: the fee note PDF carries a debit schedule splitting it between {claim.policy.insurerName} ({Number(claim.policy.leadSharePercent)}%)
          {claim.policy.coInsurers.map((c) => `, ${c.insurerName} (${Number(c.sharePercent)}%)`).join("")}.
        </p>
      )}
      {pdfErr && <ErrorNote message={pdfErr} />}
      {data.data.length === 0 ? (
        <Card><EmptyState title="No fee notes yet">{principal ? "Raise the adjuster's fee note once the final report is signed off (or an interim one before)." : "Fee notes appear here once issued."}</EmptyState></Card>
      ) : (
        data.data.map((n) => (
          <Card
            key={n.id}
            title={
              <div className="flex flex-wrap items-center gap-2">
                <Receipt className="size-4 text-slate-400" />
                <h2 className="text-sm font-semibold">{n.feeNoteNo ?? "Draft fee note"}</h2>
                <span className={clsx("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", LOOK[n.status].cls)}>{LOOK[n.status].label}</span>
              </div>
            }
            actions={<span className="text-sm font-semibold tabular-nums">{formatNaira(n.netPayable)}</span>}
          >
            <div className="grid gap-6 md:grid-cols-2">
              <Figures f={n} />
              <div className="space-y-2 text-sm text-slate-600">
                {n.issuedAt && <p>Issued {formatDateTime(n.issuedAt)}</p>}
                {n.paidAt && <p className="flex items-center gap-1 text-emerald-800"><CheckCircle2 className="size-4" /> Paid {formatDate(n.paidAt)}{n.paymentReference ? ` · ${n.paymentReference}` : ""}</p>}
                {n.cancelReason && <p className="text-red-800">Cancelled: {n.cancelReason}</p>}
                {n.notes && <p>{n.notes}</p>}
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button variant="secondary" size="sm" onClick={() => void pdf(n, "open")}><Eye className="size-3.5" /> {n.status === "DRAFT" ? "Preview" : "View PDF"}</Button>
                  <Button variant="secondary" size="sm" onClick={() => void pdf(n, "download")}><Download className="size-3.5" /> {n.status === "DRAFT" ? "Download preview" : "Download Fee Note PDF"}</Button>
                  {principal && n.status === "DRAFT" && (
                    <>
                      <Button variant="secondary" size="sm" onClick={() => setEditing(n)}>Edit</Button>
                      <Button size="sm" onClick={() => setAction({ note: n, kind: "issue" })}><Send className="size-3.5" /> Issue</Button>
                    </>
                  )}
                  {principal && n.status === "ISSUED" && <Button size="sm" onClick={() => setAction({ note: n, kind: "paid" })}><CheckCircle2 className="size-3.5" /> Mark paid</Button>}
                  {principal && (n.status === "DRAFT" || n.status === "ISSUED") && <Button variant="ghost" size="sm" onClick={() => setAction({ note: n, kind: "cancel" })}><Ban className="size-3.5" /> Cancel</Button>}
                </div>
              </div>
            </div>
          </Card>
        ))
      )}
      {editing && <FeeNoteDialog claimId={claim.id} note={editing === "new" ? null : editing} rates={data.rates} onClose={() => setEditing(null)} />}
      {action && <ActionDialog claimId={claim.id} note={action.note} kind={action.kind} onClose={() => setAction(null)} />}
    </div>
  );
}
