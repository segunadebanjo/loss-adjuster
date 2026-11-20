import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { claimsApi, queryKeys } from "@/shared/api/claims";
import { api, errorMessage, fieldErrors } from "@/shared/api/client";
import type { ClaimDetail, ClaimStatus } from "@/shared/api/types";
import { moneyToApi, moneyToInput, todayLagos } from "@/shared/lib/claims";
import { Button, ErrorNote, Field, Input, Modal, MoneyInput, Select, Textarea } from "@/shared/components/ui";

function useClaimSaved(id: number) {
  const qc = useQueryClient();
  return (claim: ClaimDetail) => {
    qc.setQueryData(queryKeys.claim(id), claim);
    void qc.invalidateQueries({ queryKey: queryKeys.claims });
    void qc.invalidateQueries({ queryKey: queryKeys.kpis });
  };
}

export function TransitionDialog({ claim, move, onClose }: { claim: ClaimDetail; move: ClaimDetail["allowedTransitions"][number] | null; onClose: () => void }) {
  const saved = useClaimSaved(claim.id);
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState(moneyToInput(claim.recommendedSettlement));
  const m = useMutation({
    mutationFn: () => claimsApi.transition(claim.id, { to: move!.to, reason: reason.trim() || undefined, settledAmount: move?.settledAmountRequired ? moneyToApi(amount) ?? undefined : undefined }),
    onSuccess: (c) => {
      saved(c);
      onClose();
    },
  });
  if (!move) return null;
  const errs = fieldErrors(m.error);
  const danger = move.to === "REPUDIATED";
  return (
    <Modal
      open
      onClose={onClose}
      title={move.label}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant={danger ? "danger" : "primary"} loading={m.isPending} onClick={() => m.mutate()}>
            {move.label}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          {claim.claimReference} moves from <strong>{claim.statusLabel}</strong> to <strong>{move.label.toLowerCase()}</strong>. This is recorded on the claim's timeline and audit trail.
        </p>
        {m.isError && !Object.keys(errs).length && <ErrorNote message={errorMessage(m.error)} />}
        {move.settledAmountRequired && (
          <Field label="Amount settled" required error={errs.settledAmount} hint="The figure agreed with the insurer.">
            {(id, d) => <MoneyInput id={id} aria-describedby={d} value={amount} onChange={setAmount} />}
          </Field>
        )}
        <Field label={move.reasonRequired ? "Reason" : "Note (optional)"} required={move.reasonRequired} error={errs.reason}>
          {(id, d) => <Textarea id={id} aria-describedby={d} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={danger ? "e.g. Breach of the security warranty…" : ""} />}
        </Field>
      </div>
    </Modal>
  );
}

export function AssignDialog({ claim, open, onClose }: { claim: ClaimDetail; open: boolean; onClose: () => void }) {
  const saved = useClaimSaved(claim.id);
  const { data: options } = useQuery({ queryKey: queryKeys.options, queryFn: claimsApi.options, enabled: open });
  const [adjusterId, setAdjusterId] = useState(String(claim.assignedAdjuster?.id ?? ""));
  const m = useMutation({
    mutationFn: () => claimsApi.assign(claim.id, adjusterId ? Number(adjusterId) : null),
    onSuccess: (c) => {
      saved(c);
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={claim.assignedAdjuster ? "Reassign adjuster" : "Assign adjuster"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={m.isPending} onClick={() => m.mutate()}>Save</Button>
        </>
      }
    >
      {m.isError && <ErrorNote message={errorMessage(m.error)} className="mb-4" />}
      <Field label="Loss adjuster">
        {(id) => (
          <Select id={id} value={adjusterId} onChange={(e) => setAdjusterId(e.target.value)}>
            <option value="">— Not assigned —</option>
            {options?.adjusters.map((a) => (
              <option key={a.id} value={a.id}>
                {a.fullName}{a.ciiQualification ? ` (${a.ciiQualification})` : ""}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </Modal>
  );
}

export function EditClaimDialog({ claim, open, onClose, principal }: { claim: ClaimDetail; open: boolean; onClose: () => void; principal: boolean }) {
  const saved = useClaimSaved(claim.id);
  const { data: options } = useQuery({ queryKey: queryKeys.options, queryFn: claimsApi.options, enabled: open });
  const [f, setF] = useState({
    insurerClaimNo: claim.insurerClaimNo ?? "",
    dateOfLoss: claim.dateOfLoss,
    dateInstructed: claim.dateInstructed,
    lossState: claim.lossState,
    lossLga: claim.lossLga ?? "",
    lossAddress: claim.lossAddress,
    incidentDescription: claim.incidentDescription,
    initialReserve: moneyToInput(claim.initialReserve),
    valueAtRisk: moneyToInput(claim.valueAtRisk),
    applyAverage: !!claim.applyAverage,
    coAdjusterFirm: claim.coAdjuster?.firm ?? "",
    coAdjusterNaicomNo: claim.coAdjuster?.naicomNo ?? "",
    coAdjusterSplitPercent: claim.coAdjuster?.splitPercent ? String(Number(claim.coAdjuster.splitPercent)) : "",
  });
  const set = (patch: Partial<typeof f>) => setF((p) => ({ ...p, ...patch }));
  const m = useMutation({
    mutationFn: () => {
      // The value at risk and average are sent only when changed: they are locked while the claim is at sign-off.
      const figuresChanged = moneyToApi(f.valueAtRisk) !== moneyToApi(moneyToInput(claim.valueAtRisk)) || f.applyAverage !== !!claim.applyAverage;
      const site = { lossLga: f.lossLga, lossAddress: f.lossAddress, incidentDescription: f.incidentDescription, ...(figuresChanged ? { valueAtRisk: moneyToApi(f.valueAtRisk), applyAverage: f.applyAverage } : {}) };
      const body = principal
        ? {
            ...site, insurerClaimNo: f.insurerClaimNo, dateOfLoss: f.dateOfLoss, dateInstructed: f.dateInstructed, lossState: f.lossState, initialReserve: moneyToApi(f.initialReserve) ?? "0",
            coAdjusterFirm: f.coAdjusterFirm, ...(f.coAdjusterFirm.trim() ? { coAdjusterNaicomNo: f.coAdjusterNaicomNo, coAdjusterSplitPercent: f.coAdjusterSplitPercent.trim() || null } : {}),
          }
        : site;
      return claimsApi.update(claim.id, body);
    },
    onSuccess: (c) => {
      saved(c);
      onClose();
    },
  });
  const errs = fieldErrors(m.error);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  return (
    <Modal open={open} onClose={onClose} title="Edit claim details" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} type="submit" form="edit-claim">Save changes</Button></>}>
      <form id="edit-claim" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {m.isError && !Object.keys(errs).length && <ErrorNote message={errorMessage(m.error)} className="sm:col-span-2" />}
        {principal && (
          <>
            <Field label="Date of loss" error={errs.dateOfLoss}>{(id) => <Input id={id} type="date" value={f.dateOfLoss} max={f.dateInstructed} onChange={(e) => set({ dateOfLoss: e.target.value })} />}</Field>
            <Field label="Date instructed" error={errs.dateInstructed}>{(id) => <Input id={id} type="date" value={f.dateInstructed} max={todayLagos()} onChange={(e) => set({ dateInstructed: e.target.value })} />}</Field>
            <Field label="Insurer's claim no." error={errs.insurerClaimNo}>{(id) => <Input id={id} value={f.insurerClaimNo} onChange={(e) => set({ insurerClaimNo: e.target.value })} />}</Field>
            <Field label="Initial reserve" error={errs.initialReserve}>{(id) => <MoneyInput id={id} value={f.initialReserve} onChange={(v) => set({ initialReserve: v })} />}</Field>
            <Field label="State" error={errs.lossState}>
              {(id) => (
                <Select id={id} value={f.lossState} onChange={(e) => set({ lossState: e.target.value })}>
                  {options?.states.map((s) => <option key={s}>{s}</option>)}
                </Select>
              )}
            </Field>
          </>
        )}
        <Field label="LGA" error={errs.lossLga}>{(id) => <Input id={id} value={f.lossLga} onChange={(e) => set({ lossLga: e.target.value })} />}</Field>
        <Field label="Address of loss" error={errs.lossAddress} className="sm:col-span-2">{(id) => <Input id={id} value={f.lossAddress} onChange={(e) => set({ lossAddress: e.target.value })} />}</Field>
        <Field label="What happened" error={errs.incidentDescription} className="sm:col-span-2">{(id) => <Textarea id={id} rows={4} value={f.incidentDescription} onChange={(e) => set({ incidentDescription: e.target.value })} />}</Field>
        <Field label="Value at risk" error={errs.valueAtRisk} hint="The full value of the property at the time of loss, for the average clause.">
          {(id, d) => <MoneyInput id={id} aria-describedby={d} value={f.valueAtRisk} onChange={(v) => set({ valueAtRisk: v })} />}
        </Field>
        <label className="flex items-center gap-2 self-center text-sm sm:mt-6">
          <input type="checkbox" checked={f.applyAverage} onChange={(e) => set({ applyAverage: e.target.checked })} className="size-4 accent-brand-600" />
          Apply the average (underinsurance) clause
        </label>
        {principal && (
          <fieldset className="grid gap-4 border-t border-slate-100 pt-4 sm:col-span-2 sm:grid-cols-3">
            <legend className="mb-2 text-sm font-medium">Co-adjusting firm (if any)</legend>
            <Field label="Firm" error={errs.coAdjusterFirm}>{(id) => <Input id={id} value={f.coAdjusterFirm} onChange={(e) => set({ coAdjusterFirm: e.target.value })} placeholder="Leave blank if none" />}</Field>
            <Field label="NAICOM reg. no." error={errs.coAdjusterNaicomNo}>{(id) => <Input id={id} value={f.coAdjusterNaicomNo} disabled={!f.coAdjusterFirm.trim()} onChange={(e) => set({ coAdjusterNaicomNo: e.target.value })} />}</Field>
            <Field label="Their share of the fee (%)" error={errs.coAdjusterSplitPercent}>{(id) => <Input id={id} inputMode="decimal" value={f.coAdjusterSplitPercent} disabled={!f.coAdjusterFirm.trim()} onChange={(e) => set({ coAdjusterSplitPercent: e.target.value.replace(/[^\d.]/g, "") })} placeholder="e.g. 30" />}</Field>
          </fieldset>
        )}
      </form>
    </Modal>
  );
}

export function DeleteClaimDialog({ claim, open, onClose }: { claim: ClaimDetail; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: () => claimsApi.remove(claim.id, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.claims });
      void qc.invalidateQueries({ queryKey: queryKeys.kpis });
      navigate("/claims", { replace: true });
    },
  });
  return (
    <Modal open={open} onClose={onClose} title="Delete this instruction?" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" loading={m.isPending} onClick={() => m.mutate()}>Delete</Button></>}>
      <p className="mb-4 text-sm text-slate-600">
        Use this only for an instruction logged by mistake. {claim.claimReference} will disappear from lists but stays in the audit trail.
      </p>
      {m.isError && <ErrorNote message={errorMessage(m.error)} className="mb-4" />}
      <Field label="Reason" required error={fieldErrors(m.error).reason}>{(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Logged twice" />}</Field>
    </Modal>
  );
}

/** The policy's co-insurers: the lead (the policy's insurer) keeps what the others don't take; shares add up to 100%. */
export function CoInsuranceDialog({ claim, open, onClose }: { claim: ClaimDetail; open: boolean; onClose: () => void }) {
  const saved = useClaimSaved(claim.id);
  const qc = useQueryClient();
  const { data: options } = useQuery({ queryKey: queryKeys.options, queryFn: claimsApi.options, enabled: open });
  const [rows, setRows] = useState(() => claim.policy.coInsurers.map((c) => ({ organisationId: String(c.organisationId), sharePercent: String(Number(c.sharePercent)) })));
  const followers = rows.reduce((a, r) => a + (Number(r.sharePercent) || 0), 0);
  const lead = Math.round((100 - followers) * 100) / 100;
  const m = useMutation({
    mutationFn: () =>
      api.patch(`/policies/${claim.policy.id}`, {
        leadSharePercent: rows.length ? String(lead) : "100",
        coInsurers: rows.map((r) => ({ organisationId: Number(r.organisationId), sharePercent: r.sharePercent || "0" })),
      }),
    onSuccess: async () => {
      saved(await claimsApi.get(claim.id));
      void qc.invalidateQueries({ queryKey: ["claims", "detail", claim.id] });
      onClose();
    },
  });
  const others = options?.insurers.filter((i) => i.id !== claim.policy.insurerOrgId) ?? [];
  return (
    <Modal open={open} onClose={onClose} title="Co-insurance" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={rows.length > 0 && lead <= 0} onClick={() => m.mutate()}>Save</Button></>}>
      <div className="space-y-4 text-sm">
        <p className="text-slate-600">
          The lead insurer is {claim.policy.insurerName}. Add the following insurers and their shares; the lead keeps the rest. Reports and fee notes split the
          figures by these shares.
        </p>
        {m.isError && <ErrorNote message={errorMessage(m.error)} />}
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_8rem_auto] items-end gap-3">
            <Field label={`Co-insurer ${i + 1}`}>
              {(id) => (
                <Select id={id} value={r.organisationId} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, organisationId: e.target.value } : x)))}>
                  <option value="">Pick an insurer</option>
                  {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Share (%)">{(id) => <Input id={id} inputMode="decimal" value={r.sharePercent} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, sharePercent: e.target.value.replace(/[^\d.]/g, "") } : x)))} />}</Field>
            <Button variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</Button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <Button variant="secondary" size="sm" onClick={() => setRows([...rows, { organisationId: "", sharePercent: "" }])}>Add co-insurer</Button>
          <span className={lead <= 0 ? "text-red-700" : "text-slate-600"}>{claim.policy.insurerName} (lead): {rows.length ? lead : 100}%</span>
        </div>
      </div>
    </Modal>
  );
}

export type { ClaimStatus };
