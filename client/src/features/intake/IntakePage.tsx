import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileSearch, RotateCcw } from "lucide-react";
import { claimsApi, queryKeys } from "@/shared/api/claims";
import { errorCode, errorMessage, fieldErrors } from "@/shared/api/client";
import type { Policy, PolicyType } from "@/shared/api/types";
import { formatNaira } from "@/shared/lib/money";
import { POLICY_TYPE_LABEL, formatDate, moneyToApi, todayLagos } from "@/shared/lib/claims";
import { Button, Card, ErrorNote, Field, Input, Modal, MoneyInput, Select, Textarea } from "@/shared/components/ui";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { PageHeader } from "@/shared/components/PageHeader";

type Lookup = Awaited<ReturnType<typeof claimsApi.verifyPolicy>>;
const AVERAGE_LINES: PolicyType[] = ["PROPERTY_FIRE", "ENGINEERING_CAR", "OIL_AND_GAS"];

const emptyPolicy = {
  policyNumber: "",
  insurerOrgId: "",
  brokerOrgId: "",
  insuredName: "",
  insuredContact: "",
  policyType: "" as PolicyType | "",
  sumInsured: "",
  excessAmount: "",
  excessPercentage: "",
  startDate: "",
  endDate: "",
};

export function IntakePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: options } = useQuery({ queryKey: queryKeys.options, queryFn: claimsApi.options });

  const [uid, setUid] = useState("");
  const [lookup, setLookup] = useState<(Lookup & { uid: string }) | null>(null);
  const [policy, setPolicy] = useState(emptyPolicy);
  const [loss, setLoss] = useState({
    dateOfLoss: "",
    dateInstructed: todayLagos(),
    insurerClaimNo: "",
    lossState: "",
    lossLga: "",
    lossAddress: "",
    incidentDescription: "",
    initialReserve: "",
    valueAtRisk: "",
    applyAverage: null as boolean | null,
    assignedAdjusterId: "",
  });
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const setP = (patch: Partial<typeof policy>) => setPolicy((p) => ({ ...p, ...patch }));
  const setL = (patch: Partial<typeof loss>) => setLoss((p) => ({ ...p, ...patch }));

  const verify = useMutation({
    mutationFn: () => claimsApi.verifyPolicy(uid.trim()),
    onSuccess: (r) => setLookup({ ...r, uid: uid.trim().toUpperCase() }),
  });

  const existing: Policy | null = lookup?.found ? lookup.policy : null;
  const policyType = (existing?.policyType ?? policy.policyType) || null;
  const applyAverage = loss.applyAverage ?? (policyType ? AVERAGE_LINES.includes(policyType) : false);

  const create = useMutation({
    mutationFn: (confirmDuplicate: boolean) =>
      claimsApi.create({
        ...(existing
          ? { policyId: existing.id }
          : {
              policy: {
                ...policy,
                naicomUid: lookup?.uid,
                brokerOrgId: policy.brokerOrgId ? Number(policy.brokerOrgId) : null,
                insurerOrgId: policy.insurerOrgId ? Number(policy.insurerOrgId) : undefined,
                policyType: policy.policyType || undefined,
                sumInsured: moneyToApi(policy.sumInsured) ?? "",
                excessAmount: moneyToApi(policy.excessAmount) ?? "0",
                excessPercentage: policy.excessPercentage.trim() || "0",
              },
            }),
        dateOfLoss: loss.dateOfLoss,
        dateInstructed: loss.dateInstructed,
        insurerClaimNo: loss.insurerClaimNo,
        lossState: loss.lossState,
        lossLga: loss.lossLga,
        lossAddress: loss.lossAddress,
        incidentDescription: loss.incidentDescription,
        initialReserve: moneyToApi(loss.initialReserve) ?? "0",
        valueAtRisk: moneyToApi(loss.valueAtRisk),
        applyAverage,
        assignedAdjusterId: loss.assignedAdjusterId ? Number(loss.assignedAdjusterId) : null,
        confirmDuplicate,
      }),
    onSuccess: (claim) => {
      void qc.invalidateQueries({ queryKey: queryKeys.claims });
      void qc.invalidateQueries({ queryKey: queryKeys.kpis });
      navigate(`/claims/${claim.id}`);
    },
    onError: (err) => {
      if (errorCode(err) === "DUPLICATE_SUSPECTED") setDuplicate(errorMessage(err));
    },
  });

  const errs = fieldErrors(create.error);
  const pe = (k: string) => errs[`policy.${k}`];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(false);
  };
  const reset = () => {
    setLookup(null);
    setPolicy(emptyPolicy);
    create.reset();
  };

  return (
    <>
      <PageHeader title="New instruction" description="Log an insurer's instruction: verify the policy, record the loss and assign an adjuster." />
      <form onSubmit={submit} noValidate className="max-w-4xl space-y-6">
        <Card title="1. Policy">
          {!lookup ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Field label="NAICOM policy UID" className="flex-1" hint="The Unique Identification Number on the policy or the insurer's instruction letter." error={verify.isError ? errorMessage(verify.error) : undefined}>
                {(id, d) => (
                  <Input
                    id={id}
                    aria-describedby={d}
                    value={uid}
                    onChange={(e) => setUid(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (uid.trim()) verify.mutate();
                      }
                    }}
                    className="font-mono uppercase"
                    placeholder="e.g. NUID-FIR-26-00008730"
                  />
                )}
              </Field>
              <Button type="button" variant="secondary" loading={verify.isPending} disabled={!uid.trim()} onClick={() => verify.mutate()} className="sm:mb-[1.4rem]">
                <FileSearch className="size-4" /> Look up
              </Button>
            </div>
          ) : existing ? (
            <div>
              <div className="flex items-start justify-between gap-3">
                <div className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
                  <div className="text-sm">
                    <p className="font-medium">Policy found: {existing.insuredName}</p>
                    <p className="text-slate-600">
                      {POLICY_TYPE_LABEL[existing.policyType]} · {existing.policyNumber} · {existing.insurerName}
                      {existing.brokerName ? ` via ${existing.brokerName}` : ""}
                    </p>
                    <p className="text-slate-600">
                      Sum insured {formatNaira(existing.sumInsured)} · {formatDate(existing.startDate)} to {formatDate(existing.endDate)}
                    </p>
                  </div>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={reset}>
                  <RotateCcw className="size-3.5" /> Change
                </Button>
              </div>
              {lookup.found && lookup.claims.length > 0 && (
                <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
                  <p className="font-medium text-slate-700">Claims already on this policy</p>
                  <ul className="mt-1 space-y-1">
                    {lookup.claims.map((cl) => (
                      <li key={cl.id} className="flex flex-wrap items-center gap-2">
                        <Link to={`/claims/${cl.id}`} className="text-brand-700 hover:underline">{cl.claimReference}</Link>
                        <span className="text-slate-500">loss on {formatDate(cl.dateOfLoss)}</span>
                        <StatusBadge status={cl.status} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="mb-4 flex items-start justify-between gap-3 text-sm">
                <p className="text-slate-600">
                  No policy with UID <span className="font-mono font-medium">{lookup.uid}</span> yet. Enter its details from the policy schedule.
                </p>
                <Button type="button" variant="ghost" size="sm" onClick={reset}>
                  <RotateCcw className="size-3.5" /> Change
                </Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Insurer" required error={pe("insurerOrgId")}>
                  {(id) => (
                    <Select id={id} value={policy.insurerOrgId} onChange={(e) => setP({ insurerOrgId: e.target.value })} aria-invalid={!!pe("insurerOrgId")}>
                      <option value="">Choose…</option>
                      {options?.insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </Select>
                  )}
                </Field>
                <Field label="Broker" hint="Leave blank for direct business." error={pe("brokerOrgId")}>
                  {(id, d) => (
                    <Select id={id} aria-describedby={d} value={policy.brokerOrgId} onChange={(e) => setP({ brokerOrgId: e.target.value })}>
                      <option value="">Direct (no broker)</option>
                      {options?.brokers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </Select>
                  )}
                </Field>
                <Field label="Policy number" required error={pe("policyNumber")}>{(id) => <Input id={id} value={policy.policyNumber} onChange={(e) => setP({ policyNumber: e.target.value })} aria-invalid={!!pe("policyNumber")} />}</Field>
                <Field label="Class of insurance" required error={pe("policyType")}>
                  {(id) => (
                    <Select id={id} value={policy.policyType} onChange={(e) => setP({ policyType: e.target.value as PolicyType })} aria-invalid={!!pe("policyType")}>
                      <option value="">Choose…</option>
                      {options?.policyTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </Select>
                  )}
                </Field>
                <Field label="Insured" required error={pe("insuredName")}>{(id) => <Input id={id} value={policy.insuredName} onChange={(e) => setP({ insuredName: e.target.value })} aria-invalid={!!pe("insuredName")} />}</Field>
                <Field label="Insured's contact" error={pe("insuredContact")}>{(id) => <Input id={id} value={policy.insuredContact} onChange={(e) => setP({ insuredContact: e.target.value })} placeholder="Name, phone, email" />}</Field>
                <Field label="Sum insured" required error={pe("sumInsured")}>{(id) => <MoneyInput id={id} value={policy.sumInsured} onChange={(v) => setP({ sumInsured: v })} aria-invalid={!!pe("sumInsured")} />}</Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Excess (₦)" error={pe("excessAmount")}>{(id) => <MoneyInput id={id} value={policy.excessAmount} onChange={(v) => setP({ excessAmount: v })} />}</Field>
                  <Field label="Excess (%)" error={pe("excessPercentage")}>
                    {(id) => <Input id={id} inputMode="decimal" value={policy.excessPercentage} onChange={(e) => setP({ excessPercentage: e.target.value.replace(/[^\d.]/g, "") })} placeholder="e.g. 10" />}
                  </Field>
                </div>
                <Field label="Cover starts" required error={pe("startDate")}>{(id) => <Input id={id} type="date" value={policy.startDate} onChange={(e) => setP({ startDate: e.target.value })} aria-invalid={!!pe("startDate")} />}</Field>
                <Field label="Cover ends" required error={pe("endDate")}>{(id) => <Input id={id} type="date" value={policy.endDate} min={policy.startDate} onChange={(e) => setP({ endDate: e.target.value })} aria-invalid={!!pe("endDate")} />}</Field>
                <p className="text-xs text-slate-500 sm:col-span-2">
                  The excess applied is whichever is greater: the fixed amount or the percentage of the adjusted loss.
                </p>
              </div>
            </div>
          )}
        </Card>

        <fieldset disabled={!lookup} className="space-y-6 disabled:opacity-50">
          <Card title="2. The loss">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Date of loss" required error={errs.dateOfLoss}>{(id) => <Input id={id} type="date" value={loss.dateOfLoss} max={loss.dateInstructed} onChange={(e) => setL({ dateOfLoss: e.target.value })} aria-invalid={!!errs.dateOfLoss} />}</Field>
              <Field label="Date instructed" required error={errs.dateInstructed}>{(id) => <Input id={id} type="date" value={loss.dateInstructed} max={todayLagos()} onChange={(e) => setL({ dateInstructed: e.target.value })} />}</Field>
              <Field label="State" required error={errs.lossState}>
                {(id) => (
                  <Select id={id} value={loss.lossState} onChange={(e) => setL({ lossState: e.target.value })} aria-invalid={!!errs.lossState}>
                    <option value="">Choose…</option>
                    {options?.states.map((s) => <option key={s}>{s}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="LGA" error={errs.lossLga}>{(id) => <Input id={id} value={loss.lossLga} onChange={(e) => setL({ lossLga: e.target.value })} placeholder="e.g. Ikeja" />}</Field>
              <Field label="Address of loss" required error={errs.lossAddress} className="sm:col-span-2">{(id) => <Input id={id} value={loss.lossAddress} onChange={(e) => setL({ lossAddress: e.target.value })} aria-invalid={!!errs.lossAddress} />}</Field>
              <Field label="What happened" required error={errs.incidentDescription} className="sm:col-span-2" hint="As described in the insurer's instruction.">
                {(id, d) => <Textarea id={id} aria-describedby={d} rows={4} value={loss.incidentDescription} onChange={(e) => setL({ incidentDescription: e.target.value })} aria-invalid={!!errs.incidentDescription} />}
              </Field>
              <Field label="Insurer's claim no." error={errs.insurerClaimNo}>{(id) => <Input id={id} value={loss.insurerClaimNo} onChange={(e) => setL({ insurerClaimNo: e.target.value })} />}</Field>
              <Field label="Initial reserve" error={errs.initialReserve} hint="The insurer's reserve, if given.">{(id, d) => <MoneyInput id={id} aria-describedby={d} value={loss.initialReserve} onChange={(v) => setL({ initialReserve: v })} />}</Field>
              <Field label="Value at risk" error={errs.valueAtRisk} hint="Optional now; needed for the average clause.">{(id, d) => <MoneyInput id={id} aria-describedby={d} value={loss.valueAtRisk} onChange={(v) => setL({ valueAtRisk: v })} />}</Field>
              <label className="flex items-center gap-2 self-center text-sm sm:mt-2">
                <input type="checkbox" checked={applyAverage} onChange={(e) => setL({ applyAverage: e.target.checked })} className="size-4 accent-brand-600" />
                Apply the average (underinsurance) clause
              </label>
            </div>
          </Card>

          <Card title="3. Assign a loss adjuster">
            <Field label="Loss adjuster" hint="You can assign later from the claim page." error={errs.assignedAdjusterId}>
              {(id, d) => (
                <Select id={id} aria-describedby={d} value={loss.assignedAdjusterId} onChange={(e) => setL({ assignedAdjusterId: e.target.value })} className="sm:max-w-sm">
                  <option value="">Assign later</option>
                  {options?.adjusters.map((a) => <option key={a.id} value={a.id}>{a.fullName}{a.ciiQualification ? ` (${a.ciiQualification})` : ""}</option>)}
                </Select>
              )}
            </Field>
          </Card>

          {create.isError && errorCode(create.error) !== "DUPLICATE_SUSPECTED" && (
            <ErrorNote message={Object.keys(errs).length ? "Some fields need attention. They are marked above." : errorMessage(create.error)} />
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => navigate(-1)}>Cancel</Button>
            <Button type="submit" loading={create.isPending}>Log instruction</Button>
          </div>
        </fieldset>
      </form>

      <Modal
        open={!!duplicate}
        onClose={() => setDuplicate(null)}
        title="Possible duplicate"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDuplicate(null)}>Go back</Button>
            <Button loading={create.isPending} onClick={() => { setDuplicate(null); create.mutate(true); }}>Log it anyway</Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">{duplicate}</p>
      </Modal>
    </>
  );
}
