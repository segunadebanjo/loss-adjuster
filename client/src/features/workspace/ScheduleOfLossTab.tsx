import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, ArrowUp, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import clsx from "clsx";
import { claimsApi, queryKeys } from "@/shared/api/claims";
import { errorMessage, fieldErrors } from "@/shared/api/client";
import type { ClaimDetail, Valuation, ValuationItem } from "@/shared/api/types";
import { workspaceApi, workspaceKeys } from "@/shared/api/workspace";
import { formatNaira } from "@/shared/lib/money";
import { moneyToApi, moneyToInput } from "@/shared/lib/claims";
import { Button, Card, EmptyState, ErrorNote, Field, Input, Modal, MoneyInput, Select, Spinner, Textarea } from "@/shared/components/ui";

const SALVAGE = "Salvage Recovery";

function useApply(claimId: number) {
  const qc = useQueryClient();
  return (v: Valuation) => {
    qc.setQueryData(workspaceKeys.valuation(claimId), v);
    // The claim's recommended settlement changes with every line.
    void qc.invalidateQueries({ queryKey: queryKeys.claim(claimId), exact: true });
    void qc.invalidateQueries({ queryKey: queryKeys.kpis });
  };
}

function LineDialog({ claimId, item, categories, onClose }: { claimId: number; item: ValuationItem | null; categories: string[]; onClose: () => void }) {
  const apply = useApply(claimId);
  const [f, setF] = useState({
    itemDescription: item?.itemDescription ?? "",
    category: item?.category ?? categories[0] ?? "",
    claimedAmount: moneyToInput(item?.claimedAmount),
    assessedAmount: moneyToInput(item?.assessedAmount),
    depreciationAmount: moneyToInput(item?.depreciationAmount),
    bettermentDeduction: moneyToInput(item?.bettermentDeduction),
    adjusterNotes: item?.adjusterNotes ?? "",
  });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const salvage = f.category === SALVAGE;
  const m = useMutation({
    mutationFn: () => {
      const body = {
        itemDescription: f.itemDescription,
        category: f.category,
        claimedAmount: salvage ? "0" : moneyToApi(f.claimedAmount) ?? "0",
        assessedAmount: moneyToApi(f.assessedAmount) ?? "0",
        depreciationAmount: salvage ? "0" : moneyToApi(f.depreciationAmount) ?? "0",
        bettermentDeduction: salvage ? "0" : moneyToApi(f.bettermentDeduction) ?? "0",
        adjusterNotes: f.adjusterNotes,
      };
      return item ? workspaceApi.updateItem(claimId, item.id, body) : workspaceApi.addItem(claimId, body);
    },
    onSuccess: (v) => { apply(v); onClose(); },
  });
  const errs = fieldErrors(m.error);
  return (
    <Modal open onClose={onClose} size="lg" title={item ? "Edit line" : "Add a line"} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate()}>{item ? "Save" : "Add line"}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {m.isError && !Object.keys(errs).length && <ErrorNote message={errorMessage(m.error)} className="sm:col-span-2" />}
        <Field label="Item" required error={errs.itemDescription} className="sm:col-span-2">{(id) => <Input id={id} value={f.itemDescription} onChange={(e) => set({ itemDescription: e.target.value })} placeholder="e.g. Injection-moulding machine No. 3" />}</Field>
        <Field label="Category" required error={errs.category}>
          {(id) => <Select id={id} value={f.category} onChange={(e) => set({ category: e.target.value })}>{categories.map((c) => <option key={c}>{c}</option>)}</Select>}
        </Field>
        {salvage ? (
          <Field label="Amount recovered" required error={errs.assessedAmount} hint="Deducted from the loss.">{(id, d) => <MoneyInput id={id} aria-describedby={d} value={f.assessedAmount} onChange={(v) => set({ assessedAmount: v })} />}</Field>
        ) : (
          <>
            <Field label="Amount claimed" error={errs.claimedAmount} hint="As presented by the insured.">{(id, d) => <MoneyInput id={id} aria-describedby={d} value={f.claimedAmount} onChange={(v) => set({ claimedAmount: v })} />}</Field>
            <Field label="Amount assessed" error={errs.assessedAmount} hint="Reinstatement or replacement cost you accept.">{(id, d) => <MoneyInput id={id} aria-describedby={d} value={f.assessedAmount} onChange={(v) => set({ assessedAmount: v })} />}</Field>
            <Field label="Less depreciation" error={errs.depreciationAmount} hint="Wear and tear for age and use.">{(id, d) => <MoneyInput id={id} aria-describedby={d} value={f.depreciationAmount} onChange={(v) => set({ depreciationAmount: v })} />}</Field>
            <Field label="Less betterment" error={errs.bettermentDeduction} hint="Where the repair leaves the insured better off.">{(id, d) => <MoneyInput id={id} aria-describedby={d} value={f.bettermentDeduction} onChange={(v) => set({ bettermentDeduction: v })} />}</Field>
          </>
        )}
        <Field label="Adjuster's notes" className="sm:col-span-2" error={errs.adjusterNotes}>{(id) => <Textarea id={id} rows={3} value={f.adjusterNotes} onChange={(e) => set({ adjusterNotes: e.target.value })} placeholder="Basis of the figure: quotes obtained, invoices seen, measurements…" />}</Field>
      </div>
    </Modal>
  );
}

function AverageForm({ claim, valuation }: { claim: ClaimDetail; valuation: Valuation }) {
  const qc = useQueryClient();
  const [varText, setVarText] = useState(moneyToInput(valuation.basis.valueAtRisk));
  const [apply, setApply] = useState(valuation.basis.applyAverage);
  const m = useMutation({
    mutationFn: () => claimsApi.update(claim.id, { valueAtRisk: moneyToApi(varText), applyAverage: apply }),
    onSuccess: (c) => {
      qc.setQueryData(queryKeys.claim(claim.id), c);
      void qc.invalidateQueries({ queryKey: workspaceKeys.valuation(claim.id) });
    },
  });
  const dirty = moneyToApi(varText) !== valuation.basis.valueAtRisk || apply !== valuation.basis.applyAverage;
  return (
    <div className="space-y-3">
      <Field label="Value at risk" hint={`Sum insured is ${formatNaira(valuation.basis.sumInsured)}.`} error={fieldErrors(m.error).valueAtRisk}>
        {(id, d) => <MoneyInput id={id} aria-describedby={d} value={varText} onChange={setVarText} disabled={!valuation.editable} />}
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={apply} disabled={!valuation.editable} onChange={(e) => setApply(e.target.checked)} className="size-4 accent-brand-600" />
        Apply the average clause
      </label>
      {m.isError && !fieldErrors(m.error).valueAtRisk && <ErrorNote message={errorMessage(m.error)} />}
      {valuation.editable && dirty && <Button size="sm" loading={m.isPending} onClick={() => m.mutate()}>Save and recalculate</Button>}
    </div>
  );
}

function Step({ label, value, sub, strong, minus }: { label: ReactNode; value: string; sub?: ReactNode; strong?: boolean; minus?: boolean }) {
  return (
    <div className={clsx("flex items-start justify-between gap-3 py-2", strong && "border-t border-slate-200 font-semibold")}>
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {sub && <p className="text-xs font-normal text-slate-500">{sub}</p>}
      </div>
      <p className="shrink-0 text-sm whitespace-nowrap tabular-nums">{minus && Number(value) !== 0 ? `− ${formatNaira(value)}` : formatNaira(value)}</p>
    </div>
  );
}

function SettlementPanel({ v }: { v: Valuation }) {
  const s = v.settlement;
  const pct = Number(v.basis.excessPercentage);
  const excessSub =
    s.excess.basis === "NONE" ? "No excess on this policy."
    : `Greater of ${formatNaira(s.excess.fixed)} fixed${pct ? ` and ${pct}% of the loss (${formatNaira(s.excess.percentageAmount)})` : ""}: ${s.excess.basis === "PERCENTAGE" ? "percentage" : "fixed"} applies.`;
  return (
    <div>
      <Step label="Total claimed" value={s.totalClaimed} />
      <Step label="Total assessed" value={s.totalAssessed} />
      <Step label="Depreciation" value={s.totalDepreciation} minus />
      <Step label="Betterment" value={s.totalBetterment} minus />
      <Step label="Salvage recovered" value={s.salvage} minus />
      <Step label="Adjusted loss" value={s.grossLoss} strong />
      <Step
        label={s.average.applied ? `Average: ${s.average.ratioPercent}% of the loss` : "Average"}
        value={s.average.reduction}
        minus
        sub={s.average.applied ? `Sum insured ${formatNaira(v.basis.sumInsured)} ÷ value at risk ${formatNaira(v.basis.valueAtRisk)}.` : s.average.reason}
      />
      <Step label="Loss after average" value={s.lossAfterAverage} strong />
      <Step label="Excess" value={s.excess.applied} minus sub={excessSub} />
      <div className="mt-2 rounded-lg bg-brand-50 p-4">
        <p className="text-sm text-brand-900">Net recommended settlement</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight text-brand-900 tabular-nums">{formatNaira(s.netRecommended)}</p>
        {s.cappedAtSumInsured && <p className="mt-1 text-xs text-brand-900/70">Limited to the sum insured.</p>}
        {Number(s.totalClaimed) > 0 && <p className="mt-1 text-xs text-brand-900/70">{formatNaira(s.savings)} below the amount claimed.</p>}
      </div>
      {s.warnings.length > 0 && (
        <ul className="mt-3 space-y-1">
          {s.warnings.map((w) => (
            <li key={w} className="flex gap-1.5 text-xs text-amber-900"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ScheduleOfLossTab({ claim }: { claim: ClaimDetail }) {
  const apply = useApply(claim.id);
  const { data: v, isPending, isError, error } = useQuery({ queryKey: workspaceKeys.valuation(claim.id), queryFn: () => workspaceApi.valuation(claim.id) });
  const [editing, setEditing] = useState<ValuationItem | null | "new">(null);
  const [deleting, setDeleting] = useState<ValuationItem | null>(null);
  const reorder = useMutation({ mutationFn: (ids: number[]) => workspaceApi.reorder(claim.id, ids), onSuccess: apply });
  const remove = useMutation({ mutationFn: (id: number) => workspaceApi.deleteItem(claim.id, id), onSuccess: (r) => { apply(r); setDeleting(null); } });

  if (isPending) return <Spinner />;
  if (isError || !v) return <ErrorNote message={errorMessage(error)} />;
  const move = (i: number, dir: -1 | 1) => {
    const ids = v.items.map((x) => x.id);
    [ids[i], ids[i + dir]] = [ids[i + dir]!, ids[i]!];
    reorder.mutate(ids);
  };

  return (
    <div className="grid gap-6 2xl:grid-cols-3">
      <div className="space-y-4 2xl:col-span-2">
        {!v.editable && (
          <div className="flex gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <Lock className="mt-0.5 size-4 shrink-0" /> The schedule is locked while the claim is "{claim.statusLabel}".
          </div>
        )}
        <Card title="Schedule of loss" bodyClassName="p-0" actions={v.editable && <Button size="sm" onClick={() => setEditing("new")}><Plus className="size-4" /> Add line</Button>}>
          {v.items.length === 0 ? (
            <EmptyState title="No lines yet">Add each item claimed, with your assessed figure and deductions.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr className="border-b border-slate-100">
                    <th className="px-4 py-2.5 font-medium">Item</th>
                    <th className="px-3 py-2.5 text-right font-medium">Claimed</th>
                    <th className="px-3 py-2.5 text-right font-medium">Assessed</th>
                    <th className="px-3 py-2.5 text-right font-medium">Deductions</th>
                    <th className="px-3 py-2.5 text-right font-medium">Net</th>
                    {v.editable && <th className="px-3 py-2.5"><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {v.items.map((it, i) => {
                    const salvage = it.category === SALVAGE;
                    return (
                      <tr key={it.id} className="border-b border-slate-50 align-top last:border-0">
                        <td className="min-w-56 px-4 py-3">
                          <p className="font-medium">{it.itemDescription}</p>
                          <p className="text-xs text-slate-500">{it.category}</p>
                          {it.adjusterNotes && <p className="mt-1 text-xs text-slate-600">{it.adjusterNotes}</p>}
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums">{salvage ? "—" : formatNaira(it.claimedAmount)}</td>
                        <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums">{formatNaira(it.assessedAmount)}</td>
                        <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums">
                          {salvage ? "—" : (
                            <>
                              {formatNaira(it.deductions)}
                              {Number(it.depreciationAmount) > 0 && <p className="text-xs text-slate-500">depreciation {formatNaira(it.depreciationAmount)}</p>}
                              {Number(it.bettermentDeduction) > 0 && <p className="text-xs text-slate-500">betterment {formatNaira(it.bettermentDeduction)}</p>}
                            </>
                          )}
                        </td>
                        <td className={clsx("px-3 py-3 text-right font-medium whitespace-nowrap tabular-nums", salvage && "text-red-700")}>
                          {salvage ? `− ${formatNaira(it.netPayable)}` : formatNaira(it.netPayable)}
                        </td>
                        {v.editable && (
                          <td className="px-3 py-2">
                            <div className="flex justify-end">
                              <button type="button" disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)} className="grid size-8 place-items-center rounded text-slate-400 hover:bg-slate-100 disabled:opacity-30" aria-label="Move up"><ArrowUp className="size-4" /></button>
                              <button type="button" disabled={i === v.items.length - 1 || reorder.isPending} onClick={() => move(i, 1)} className="grid size-8 place-items-center rounded text-slate-400 hover:bg-slate-100 disabled:opacity-30" aria-label="Move down"><ArrowDown className="size-4" /></button>
                              <button type="button" onClick={() => setEditing(it)} className="grid size-8 place-items-center rounded text-slate-500 hover:bg-slate-100" aria-label={`Edit ${it.itemDescription}`}><Pencil className="size-4" /></button>
                              <button type="button" onClick={() => setDeleting(it)} className="grid size-8 place-items-center rounded text-slate-400 hover:bg-red-50 hover:text-red-700" aria-label={`Delete ${it.itemDescription}`}><Trash2 className="size-4" /></button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t border-slate-200 text-sm font-semibold">
                  <tr>
                    <td className="px-4 py-3">Totals</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatNaira(v.settlement.totalClaimed)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatNaira(v.settlement.totalAssessed)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatNaira(v.totalDeductions)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatNaira(v.settlement.grossLoss)}</td>
                    {v.editable && <td />}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {reorder.isError && <ErrorNote message={errorMessage(reorder.error)} className="m-4" />}
        </Card>
      </div>
      <div className="grid items-start gap-6 md:grid-cols-2 2xl:grid-cols-1 2xl:content-start">
        <Card title="Underinsurance (average)"><AverageForm key={`${v.basis.valueAtRisk}-${v.basis.applyAverage}`} claim={claim} valuation={v} /></Card>
        <Card title="Settlement"><SettlementPanel v={v} /></Card>
      </div>

      {editing && <LineDialog claimId={claim.id} item={editing === "new" ? null : editing} categories={v.categories} onClose={() => setEditing(null)} />}
      {deleting && (
        <Modal open onClose={() => setDeleting(null)} title="Delete this line?" footer={<><Button variant="secondary" onClick={() => setDeleting(null)}>Cancel</Button><Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate(deleting.id)}>Delete</Button></>}>
          <p className="text-sm text-slate-600">{deleting.itemDescription} ({formatNaira(deleting.netPayable)}) will be removed and the settlement recalculated. The audit trail keeps a copy.</p>
          {remove.isError && <ErrorNote message={errorMessage(remove.error)} className="mt-3" />}
        </Modal>
      )}
    </div>
  );
}
