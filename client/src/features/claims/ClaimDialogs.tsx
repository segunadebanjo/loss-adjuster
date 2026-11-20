import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { claimsApi, queryKeys } from "@/shared/api/claims";
import { errorMessage, fieldErrors } from "@/shared/api/client";
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
  });
  const set = (patch: Partial<typeof f>) => setF((p) => ({ ...p, ...patch }));
  const m = useMutation({
    mutationFn: () => {
      const site = { lossLga: f.lossLga, lossAddress: f.lossAddress, incidentDescription: f.incidentDescription, valueAtRisk: moneyToApi(f.valueAtRisk), applyAverage: f.applyAverage };
      const body = principal
        ? { ...site, insurerClaimNo: f.insurerClaimNo, dateOfLoss: f.dateOfLoss, dateInstructed: f.dateInstructed, lossState: f.lossState, initialReserve: moneyToApi(f.initialReserve) ?? "0" }
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

export type { ClaimStatus };
