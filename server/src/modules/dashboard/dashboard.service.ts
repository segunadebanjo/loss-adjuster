import type { ClaimStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { CLOSED_STATUSES, LINES, OPEN_STATUSES, STATUS_LABEL, type Line } from "../../lib/claimWorkflow.js";
import { fromKobo, mulDiv, toKobo } from "../../lib/money.js";
import { computeSla, SLA_KEYS, type SlaState } from "../../lib/sla.js";
import type { AuthUser } from "../../middleware/authenticate.js";
import { buildClaimWhere, loadSlaTargets } from "../claims/claims.service.js";
import type { ClaimFilters } from "../claims/claims.schema.js";

const lineOf = (policyType: string): Line =>
  (Object.entries(LINES).find(([, l]) => (l.types as readonly string[]).includes(policyType))?.[0] ?? "GENERAL_ACCIDENT") as Line;

/**
 * Every dashboard figure for the caller's scope and filters, in one response. All sums are integer kobo.
 * "Adjusted" claims are those with a figure: staff count the recommended (or settled) amount; insurers only
 * settled claims, since recommendations are not shown to them before settlement.
 */
export async function dashboardKpis(user: AuthUser, filters: ClaimFilters, now = new Date()) {
  const where = buildClaimWhere(user, filters);
  const claims = await prisma.claim.findMany({
    where,
    select: {
      id: true,
      status: true,
      dateInstructed: true,
      initialReserve: true,
      recommendedSettlement: true,
      settledAmount: true,
      assignedAdjusterId: true,
      policy: { select: { policyType: true } },
      statusHistory: { select: { fromStatus: true, toStatus: true, changedAt: true } },
      inspections: { where: { deletedAt: null }, select: { completedDate: true, scheduledDate: true } },
      reports: { where: { type: "FINAL", status: "APPROVED" }, orderBy: { reviewedAt: "desc" }, take: 1, select: { reviewedAt: true } },
    },
  });
  const targets = await loadSlaTargets();
  const isOpen = (s: ClaimStatus) => OPEN_STATUSES.includes(s);
  const open = claims.filter((c) => isOpen(c.status));

  // Pending inspections: open claims at the inspection stage with nothing completed yet.
  const pending = open.filter(
    (c) => (c.status === "NEW_INSTRUCTION" || c.status === "INSPECTION_SCHEDULED") && !c.inspections.some((i) => i.completedDate),
  );
  const unscheduled = pending.filter((c) => c.inspections.length === 0).length;
  const overdueScheduled = pending.filter((c) => c.inspections.some((i) => !i.completedDate && i.scheduledDate < now)).length;

  // Claimed vs adjusted.
  const adjusted = claims.filter((c) =>
    user.role === "INSURER" ? c.status === "SETTLED" && c.settledAmount != null : (c.settledAmount ?? c.recommendedSettlement) != null,
  );
  const claimedSums = adjusted.length
    ? await prisma.valuationItem.groupBy({
        by: ["claimId"],
        where: { claimId: { in: adjusted.map((c) => c.id) }, category: { not: "Salvage Recovery" } },
        _sum: { claimedAmount: true },
      })
    : [];
  const claimedByClaim = new Map(claimedSums.map((s) => [s.claimId, toKobo(String(s._sum.claimedAmount ?? "0"))]));
  let totalClaimed = 0n;
  let totalAdjusted = 0n;
  let compared = 0;
  for (const c of adjusted) {
    const claimed = claimedByClaim.get(c.id);
    if (claimed == null || claimed === 0n) continue; // no schedule of loss to compare against
    totalClaimed += claimed;
    totalAdjusted += toKobo(String(c.settledAmount ?? c.recommendedSettlement));
    compared += 1;
  }
  const savings = totalClaimed - totalAdjusted;
  const savingsPercent = totalClaimed > 0n ? Number(mulDiv(savings, 10000n, totalClaimed)) / 100 : null;

  // SLA tracker: how many claims are in each state, per milestone.
  const emptyCounts = (): Record<SlaState, number> => ({ NOT_STARTED: 0, ON_TRACK: 0, AT_RISK: 0, BREACHED: 0, MET: 0, MISSED: 0, NOT_APPLICABLE: 0 });
  const sla = SLA_KEYS.map((key) => {
    const t = targets.find((x) => x.key === key);
    return { key, label: t?.label ?? key, targetDays: t?.targetDays ?? 0, businessDays: t?.businessDays ?? false, counts: emptyCounts() };
  });
  for (const c of claims) {
    for (const clock of computeSla({ dateInstructed: c.dateInstructed, status: c.status, history: c.statusHistory, inspections: c.inspections, signedOffAt: c.reports[0]?.reviewedAt ?? null }, targets, now)) {
      const row = sla.find((s) => s.key === clock.key);
      if (row) row.counts[clock.state] += 1;
    }
  }
  const slaSummary = sla.map((s) => {
    const finished = s.counts.MET + s.counts.MISSED;
    return { ...s, onTimeRate: finished ? Math.round((s.counts.MET / finished) * 1000) / 10 : null };
  });

  const byStatus = (Object.keys(STATUS_LABEL) as ClaimStatus[]).map((status) => ({
    status,
    label: STATUS_LABEL[status],
    count: claims.filter((c) => c.status === status).length,
  }));

  const byLine = (Object.keys(LINES) as Line[]).map((line) => {
    const inLine = claims.filter((c) => lineOf(c.policy.policyType) === line);
    const openInLine = inLine.filter((c) => isOpen(c.status));
    return {
      line,
      label: LINES[line].label,
      count: inLine.length,
      open: openInLine.length,
      openReserve: fromKobo(openInLine.reduce((sum, c) => sum + toKobo(String(c.initialReserve)), 0n)),
    };
  });

  let workload: Array<{ adjusterId: number; fullName: string; open: number }> = [];
  if (user.role === "ADMIN") {
    const adjusters = await prisma.user.findMany({ where: { role: "ADJUSTER", isActive: true }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } });
    workload = adjusters.map((a) => ({ adjusterId: a.id, fullName: a.fullName, open: open.filter((c) => c.assignedAdjusterId === a.id).length }));
  }

  return {
    activeInstructions: open.length,
    closedClaims: claims.filter((c) => CLOSED_STATUSES.includes(c.status)).length,
    unassigned: open.filter((c) => c.assignedAdjusterId == null).length,
    pendingInspections: { total: pending.length, unscheduled, overdue: overdueScheduled },
    openReserve: fromKobo(open.reduce((sum, c) => sum + toKobo(String(c.initialReserve)), 0n)),
    claimedVsAdjusted: {
      claimsCompared: compared,
      totalClaimed: fromKobo(totalClaimed),
      totalAdjusted: fromKobo(totalAdjusted),
      savings: fromKobo(savings),
      savingsPercent,
    },
    sla: slaSummary,
    byStatus,
    byLine,
    workload,
  };
}
