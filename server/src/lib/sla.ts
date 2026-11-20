import type { ClaimStatus } from "@prisma/client";
import { businessDaysBetween, calendarDaysBetween } from "./dates.js";

/**
 * SLA clocks for one claim, worked out from its status history and inspections (nothing is stored). Pure.
 *   INSPECTION     instruction date -> first completed inspection (else first move to UNDER_INVESTIGATION)
 *   PRELIM_REPORT  instruction date -> first move to PRELIM_REPORT_SUBMITTED
 *   FINAL_REPORT   documents complete (latest move into FINAL_REPORT_DRAFTED) -> next move to PENDING_SIGNOFF
 *   SIGNOFF        latest move into PENDING_SIGNOFF -> final report signed off, or leaving it (settled, repudiated, returned)
 * Open clocks are AT_RISK from 80% of the target. Clocks that never started on a closed claim are NOT_APPLICABLE.
 */
export type SlaKey = "INSPECTION" | "PRELIM_REPORT" | "FINAL_REPORT" | "SIGNOFF";
export type SlaState = "NOT_STARTED" | "ON_TRACK" | "AT_RISK" | "BREACHED" | "MET" | "MISSED" | "NOT_APPLICABLE";

export interface SlaTargetInput {
  key: string;
  label: string;
  targetDays: number;
  businessDays: boolean;
}
export interface SlaClaimInput {
  dateInstructed: Date;
  status: ClaimStatus;
  history: Array<{ fromStatus: ClaimStatus | null; toStatus: ClaimStatus; changedAt: Date }>;
  inspections: Array<{ completedDate: Date | null }>;
  /** When the latest final report was signed off; ends the SIGNOFF clock even if the claim waits for settlement. */
  signedOffAt?: Date | null;
}
export interface SlaClock {
  key: SlaKey;
  label: string;
  targetDays: number;
  businessDays: boolean;
  startedAt: string | null;
  completedAt: string | null;
  elapsedDays: number | null;
  state: SlaState;
}

export const SLA_KEYS: SlaKey[] = ["INSPECTION", "PRELIM_REPORT", "FINAL_REPORT", "SIGNOFF"];
const CLOSED: ClaimStatus[] = ["SETTLED", "REPUDIATED"];

export function computeSla(claim: SlaClaimInput, targets: SlaTargetInput[], now = new Date()): SlaClock[] {
  const hist = [...claim.history].sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime());
  const firstTo = (s: ClaimStatus, after?: Date) => hist.find((h) => h.toStatus === s && (!after || h.changedAt >= after))?.changedAt ?? null;
  const lastTo = (s: ClaimStatus) => [...hist].reverse().find((h) => h.toStatus === s)?.changedAt ?? null;
  const leaving = (s: ClaimStatus, after: Date) => hist.find((h) => h.fromStatus === s && h.changedAt >= after)?.changedAt ?? null;

  const inspected = claim.inspections
    .map((i) => i.completedDate)
    .filter((d): d is Date => d != null)
    .sort((a, b) => a.getTime() - b.getTime())[0];

  const spans: Record<SlaKey, [Date | null, Date | null]> = {
    INSPECTION: [claim.dateInstructed, inspected ?? firstTo("UNDER_INVESTIGATION")],
    PRELIM_REPORT: [claim.dateInstructed, firstTo("PRELIM_REPORT_SUBMITTED")],
    FINAL_REPORT: (() => {
      const start = lastTo("FINAL_REPORT_DRAFTED");
      return [start, start ? firstTo("PENDING_SIGNOFF", start) : null];
    })(),
    SIGNOFF: (() => {
      const start = lastTo("PENDING_SIGNOFF");
      if (!start) return [null, null];
      const left = leaving("PENDING_SIGNOFF", start);
      const signed = claim.signedOffAt && claim.signedOffAt >= start ? claim.signedOffAt : null;
      return [start, left && signed ? (left < signed ? left : signed) : (left ?? signed)];
    })(),
  };

  const closed = CLOSED.includes(claim.status);
  return SLA_KEYS.flatMap((key) => {
    const t = targets.find((x) => x.key === key);
    if (!t) return [];
    const [start, end] = spans[key];
    const base = { key, label: t.label, targetDays: t.targetDays, businessDays: t.businessDays };
    if (!start) {
      return [{ ...base, startedAt: null, completedAt: null, elapsedDays: null, state: closed ? "NOT_APPLICABLE" : "NOT_STARTED" } as SlaClock];
    }
    const stop = end ?? now;
    const elapsed = t.businessDays ? businessDaysBetween(start, stop) : calendarDaysBetween(start, stop);
    let state: SlaState;
    if (end) state = elapsed <= t.targetDays ? "MET" : "MISSED";
    else if (closed) state = "NOT_APPLICABLE";
    else if (elapsed > t.targetDays) state = "BREACHED";
    else if (elapsed >= Math.ceil(t.targetDays * 0.8)) state = "AT_RISK";
    else state = "ON_TRACK";
    return [{ ...base, startedAt: start.toISOString(), completedAt: end?.toISOString() ?? null, elapsedDays: elapsed, state }];
  });
}
