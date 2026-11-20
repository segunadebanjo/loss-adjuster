import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarPlus, CheckCircle2, ClipboardCheck, LocateFixed, MapPin, Pencil, X } from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { claimsApi, queryKeys } from "@/shared/api/claims";
import { errorMessage, fieldErrors } from "@/shared/api/client";
import type { ClaimDetail, Inspection } from "@/shared/api/types";
import { workspaceApi, workspaceKeys } from "@/shared/api/workspace";
import { formatDateTime, isoToLagosInput, lagosInputToIso, nowLagosInput } from "@/shared/lib/claims";
import { Button, Card, EmptyState, ErrorNote, Field, Input, Modal, Select, Spinner, Textarea } from "@/shared/components/ui";

function useRefresh(claimId: number) {
  const qc = useQueryClient();
  return (rows: Inspection[]) => {
    qc.setQueryData(workspaceKeys.inspections(claimId), rows);
    // Scheduling or completing can move the claim's status and SLA clocks.
    void qc.invalidateQueries({ queryKey: queryKeys.claim(claimId), exact: true });
    void qc.invalidateQueries({ queryKey: queryKeys.claims, refetchType: "none" });
    void qc.invalidateQueries({ queryKey: queryKeys.kpis });
  };
}

function ScheduleDialog({ claim, onClose }: { claim: ClaimDetail; onClose: () => void }) {
  const { user } = useAuth();
  const refresh = useRefresh(claim.id);
  const { data: options } = useQuery({ queryKey: queryKeys.options, queryFn: claimsApi.options, enabled: user?.role === "ADMIN" });
  const [when, setWhen] = useState("");
  const [adjusterId, setAdjusterId] = useState(String(claim.assignedAdjuster?.id ?? ""));
  const [notes, setNotes] = useState("");
  const m = useMutation({
    mutationFn: () => workspaceApi.scheduleInspection(claim.id, { scheduledDate: when ? lagosInputToIso(when) : "", adjusterId: adjusterId ? Number(adjusterId) : undefined, siteNotes: notes }),
    onSuccess: (rows) => {
      refresh(rows);
      onClose();
    },
  });
  const errs = fieldErrors(m.error);
  return (
    <Modal open onClose={onClose} title="Schedule a site inspection" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Schedule</Button></>}>
      <div className="space-y-4">
        {m.isError && !Object.keys(errs).length && <ErrorNote message={errorMessage(m.error)} />}
        <Field label="Date and time (Lagos)" required error={errs.scheduledDate}>{(id) => <Input id={id} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />}</Field>
        {user?.role === "ADMIN" && (
          <Field label="Inspecting adjuster" error={errs.adjusterId}>
            {(id) => (
              <Select id={id} value={adjusterId} onChange={(e) => setAdjusterId(e.target.value)}>
                {options?.adjusters.map((a) => <option key={a.id} value={a.id}>{a.fullName}</option>)}
              </Select>
            )}
          </Field>
        )}
        <Field label="Notes for the visit" hint="e.g. who to meet on site, access arrangements.">{(id, d) => <Textarea id={id} aria-describedby={d} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        {claim.status === "NEW_INSTRUCTION" && <p className="text-xs text-slate-500">The claim will move to "Inspection scheduled".</p>}
      </div>
    </Modal>
  );
}

function FindingsDialog({ claim, inspection, onClose }: { claim: ClaimDetail; inspection: Inspection; onClose: () => void }) {
  const refresh = useRefresh(claim.id);
  const [f, setF] = useState({
    scheduledDate: isoToLagosInput(inspection.scheduledDate),
    completedDate: isoToLagosInput(inspection.completedDate) || nowLagosInput(),
    done: true,
    lat: inspection.gpsLatitude?.toString() ?? "",
    lng: inspection.gpsLongitude?.toString() ?? "",
    siteNotes: inspection.siteNotes ?? "",
    causeOfLossVerified: inspection.causeOfLossVerified,
    policyLiabilityConfirmed: inspection.policyLiabilityConfirmed,
    thirdPartyInvolvement: inspection.thirdPartyInvolvement,
  });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const [locating, setLocating] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () =>
      workspaceApi.updateInspection(claim.id, inspection.id, {
        scheduledDate: lagosInputToIso(f.scheduledDate),
        completedDate: f.done ? lagosInputToIso(f.completedDate) : null,
        gpsLatitude: f.lat.trim() === "" ? null : Number(f.lat),
        gpsLongitude: f.lng.trim() === "" ? null : Number(f.lng),
        siteNotes: f.siteNotes,
        causeOfLossVerified: f.causeOfLossVerified,
        policyLiabilityConfirmed: f.policyLiabilityConfirmed,
        thirdPartyInvolvement: f.thirdPartyInvolvement,
      }),
    onSuccess: (rows) => {
      refresh(rows);
      onClose();
    },
  });
  const errs = fieldErrors(m.error);
  const locate = () => {
    if (!navigator.geolocation) return setLocating("This browser can't share its location.");
    setLocating("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        set({ lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) });
        setLocating(`Located to within ${Math.round(pos.coords.accuracy)} m.`);
      },
      (err) => setLocating(err.code === err.PERMISSION_DENIED ? "Location permission was refused. Type the coordinates instead." : "Couldn't get a location fix. Type the coordinates instead."),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };
  const check = (key: "causeOfLossVerified" | "policyLiabilityConfirmed" | "thirdPartyInvolvement", label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={f[key]} onChange={(e) => set({ [key]: e.target.checked })} className="size-4 accent-brand-600" />
      {label}
    </label>
  );
  return (
    <Modal open onClose={onClose} size="lg" title={inspection.completedDate ? "Edit inspection findings" : "Record the site inspection"} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {m.isError && !Object.keys(errs).length && <ErrorNote message={errorMessage(m.error)} className="sm:col-span-2" />}
        <Field label="Scheduled for" error={errs.scheduledDate}>{(id) => <Input id={id} type="datetime-local" value={f.scheduledDate} onChange={(e) => set({ scheduledDate: e.target.value })} />}</Field>
        <div>
          <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={f.done} onChange={(e) => set({ done: e.target.checked })} className="size-4 accent-brand-600" />
            Visit completed at
          </label>
          <Input aria-label="Completed at" type="datetime-local" value={f.completedDate} max={nowLagosInput()} disabled={!f.done} onChange={(e) => set({ completedDate: e.target.value })} />
          {errs.completedDate && <p className="mt-1 text-xs text-red-700">{errs.completedDate}</p>}
        </div>
        <div className="sm:col-span-2">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Latitude" error={errs.gpsLatitude} className="w-40">{(id) => <Input id={id} inputMode="decimal" value={f.lat} onChange={(e) => set({ lat: e.target.value })} placeholder="6.596500" />}</Field>
            <Field label="Longitude" error={errs.gpsLongitude} className="w-40">{(id) => <Input id={id} inputMode="decimal" value={f.lng} onChange={(e) => set({ lng: e.target.value })} placeholder="3.351500" />}</Field>
            <Button type="button" variant="secondary" onClick={locate} className={errs.gpsLatitude || errs.gpsLongitude ? "mb-5" : ""}>
              <LocateFixed className="size-4" /> Use my location
            </Button>
          </div>
          {locating && <p className="mt-1 text-xs text-slate-500">{locating}</p>}
        </div>
        <Field label="Site notes" className="sm:col-span-2" error={errs.siteNotes}>{(id) => <Textarea id={id} rows={5} value={f.siteNotes} onChange={(e) => set({ siteNotes: e.target.value })} placeholder="What you saw, who you met, measurements, damage extent…" />}</Field>
        <div className="space-y-2 sm:col-span-2">
          {check("causeOfLossVerified", "Cause of loss verified")}
          {check("policyLiabilityConfirmed", "Policy liability confirmed (the loss is covered)")}
          {check("thirdPartyInvolvement", "A third party is involved (possible recovery)")}
        </div>
        {f.done && !inspection.completedDate && claim.status === "INSPECTION_SCHEDULED" && <p className="text-xs text-slate-500 sm:col-span-2">The claim will move to "Under investigation".</p>}
      </div>
    </Modal>
  );
}

function CancelDialog({ claimId, inspection, onClose }: { claimId: number; inspection: Inspection; onClose: () => void }) {
  const refresh = useRefresh(claimId);
  const [reason, setReason] = useState("");
  const m = useMutation({ mutationFn: () => workspaceApi.cancelInspection(claimId, inspection.id, reason), onSuccess: (rows) => { refresh(rows); onClose(); } });
  return (
    <Modal open onClose={onClose} title="Cancel this visit?" footer={<><Button variant="secondary" onClick={onClose}>Keep it</Button><Button variant="danger" loading={m.isPending} onClick={() => m.mutate()}>Cancel visit</Button></>}>
      {m.isError && <ErrorNote message={errorMessage(m.error)} className="mb-4" />}
      <Field label="Reason" required>{(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The insured asked to reschedule" />}</Field>
    </Modal>
  );
}

function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      {on ? <CheckCircle2 className="size-4 text-emerald-600" aria-hidden /> : <X className="size-4 text-slate-300" aria-hidden />}
      <span className={on ? "" : "text-slate-500"}>{label}: {on ? "Yes" : "No"}</span>
    </li>
  );
}

export function InspectionTab({ claim }: { claim: ClaimDetail }) {
  const { data, isPending, isError, error } = useQuery({ queryKey: workspaceKeys.inspections(claim.id), queryFn: () => workspaceApi.inspections(claim.id) });
  const [dialog, setDialog] = useState<null | { kind: "schedule" } | { kind: "findings" | "cancel"; inspection: Inspection }>(null);
  const writable = claim.permissions.edit;

  return (
    <div className="space-y-4">
      {writable && (
        <div className="flex justify-end">
          <Button onClick={() => setDialog({ kind: "schedule" })}>
            <CalendarPlus className="size-4" /> Schedule inspection
          </Button>
        </div>
      )}
      {isPending && <Spinner />}
      {isError && <ErrorNote message={errorMessage(error)} />}
      {data && data.length === 0 && (
        <Card><EmptyState title="No inspection yet">Schedule the site visit to start the clock on the investigation.</EmptyState></Card>
      )}
      {data?.map((i) => (
        <Card
          key={i.id}
          title={
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">{i.completedDate ? `Inspected ${formatDateTime(i.completedDate)}` : `Scheduled for ${formatDateTime(i.scheduledDate)}`}</h2>
              {!i.completedDate && new Date(i.scheduledDate) < new Date() && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-900 ring-1 ring-amber-200">Overdue</span>}
            </div>
          }
          actions={
            writable && (
              <div className="flex gap-1">
                <Button variant={i.completedDate ? "ghost" : "primary"} size="sm" onClick={() => setDialog({ kind: "findings", inspection: i })}>
                  {i.completedDate ? <><Pencil className="size-3.5" /> Edit</> : <><ClipboardCheck className="size-3.5" /> Record findings</>}
                </Button>
                {!i.completedDate && <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: "cancel", inspection: i })}>Cancel</Button>}
              </div>
            )
          }
        >
          <div className="grid gap-4 text-sm md:grid-cols-3">
            <div className="space-y-1 md:col-span-2">
              <p className="text-slate-500">By {i.adjuster.fullName}</p>
              {i.siteNotes ? <p className="whitespace-pre-line">{i.siteNotes}</p> : <p className="text-slate-400">No notes yet.</p>}
            </div>
            <div className="space-y-3">
              {i.gpsLatitude != null && i.gpsLongitude != null ? (
                <div>
                  <a className="inline-flex items-center gap-1 text-brand-700 hover:underline" href={`https://www.google.com/maps?q=${i.gpsLatitude},${i.gpsLongitude}`} target="_blank" rel="noreferrer">
                    <MapPin className="size-4" /> {i.gpsLatitude.toFixed(5)}, {i.gpsLongitude.toFixed(5)}
                  </a>
                  {i.gpsOutsideNigeria && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-amber-800"><AlertTriangle className="size-3.5" /> Outside Nigeria: check the coordinates.</p>
                  )}
                </div>
              ) : (
                <p className="text-slate-400">No GPS location.</p>
              )}
              {i.completedDate && (
                <ul className="space-y-1">
                  <Flag on={i.causeOfLossVerified} label="Cause of loss verified" />
                  <Flag on={i.policyLiabilityConfirmed} label="Policy liability confirmed" />
                  <Flag on={i.thirdPartyInvolvement} label="Third party involved" />
                </ul>
              )}
            </div>
          </div>
        </Card>
      ))}
      {dialog?.kind === "schedule" && <ScheduleDialog claim={claim} onClose={() => setDialog(null)} />}
      {dialog?.kind === "findings" && <FindingsDialog claim={claim} inspection={dialog.inspection} onClose={() => setDialog(null)} />}
      {dialog?.kind === "cancel" && <CancelDialog claimId={claim.id} inspection={dialog.inspection} onClose={() => setDialog(null)} />}
    </div>
  );
}
