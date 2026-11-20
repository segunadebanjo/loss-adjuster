import type { ClaimStatus, PolicyType, Prisma } from "@prisma/client";
import { NIGERIAN_STATES } from "../../lib/nigeria.js";
import { prisma, type Tx } from "../../lib/prisma.js";
import { claimScope } from "../../lib/scope.js";
import { diffRecords, recordAudit } from "../../lib/audit.js";
import { allocateClaimReference } from "../../lib/claimRef.js";
import { badRequest, conflict, forbidden, notFound, unprocessable, AppError } from "../../lib/errors.js";
import { calendarDaysBetween, dateIn, dateOut, todayLagos } from "../../lib/dates.js";
import { moneyOut } from "../../lib/money.js";
import { computeSla } from "../../lib/sla.js";
import {
  CLAIM_TRANSITIONS,
  CLOSED_STATUSES,
  LINES,
  OPEN_STATUSES,
  STATUS_LABEL,
  findTransition,
} from "../../lib/claimWorkflow.js";
import type { AuthUser } from "../../middleware/authenticate.js";
import { createPolicyTx, policyOut } from "../policies/policies.service.js";
import { recomputeSettlement } from "../valuation/settlementStore.js";

export const POLICY_TYPE_LABELS = [
  { value: "MOTOR", label: "Motor" },
  { value: "PROPERTY_FIRE", label: "Property / Fire" },
  { value: "MARINE_CARGO", label: "Marine Cargo" },
  { value: "OIL_AND_GAS", label: "Oil & Gas" },
  { value: "ENGINEERING_CAR", label: "Engineering / CAR" },
  { value: "GENERAL_ACCIDENT", label: "General Accident" },
] as const;
import {
  ADJUSTER_EDITABLE,
  type ClaimFilters,
  type ClaimListQuery,
  type ClaimUpdate,
  type IntakeInput,
} from "./claims.schema.js";

// Lines of business where the average (underinsurance) clause normally applies; intake defaults applyAverage from it.
const AVERAGE_BY_DEFAULT = new Set(["PROPERTY_FIRE", "ENGINEERING_CAR", "OIL_AND_GAS"]);

/** Filters shared by the claims list and the dashboard, always ANDed with the caller's scope. */
export function buildClaimWhere(user: AuthUser, f: ClaimFilters): Prisma.ClaimWhereInput {
  const and: Prisma.ClaimWhereInput[] = [claimScope(user)];
  if (f.status?.length) and.push({ status: { in: f.status } });
  if (f.state === "open") and.push({ status: { in: OPEN_STATUSES } });
  if (f.state === "closed") and.push({ status: { in: CLOSED_STATUSES } });
  if (f.adjusterId === "unassigned") and.push({ assignedAdjusterId: null });
  else if (f.adjusterId) and.push({ assignedAdjusterId: f.adjusterId });
  const types: PolicyType[] = [...(f.policyType ?? []), ...(f.line ?? []).flatMap((l) => [...LINES[l].types])];
  if (types.length) and.push({ policy: { policyType: { in: types } } });
  if (f.insurerId) and.push({ policy: { insurerOrgId: f.insurerId } });
  if (f.from) and.push({ dateInstructed: { gte: dateIn(f.from) } });
  if (f.to) and.push({ dateInstructed: { lte: dateIn(f.to) } });
  if (f.q) {
    and.push({
      OR: [
        { claimReference: { contains: f.q } },
        { insurerClaimNo: { contains: f.q } },
        { policy: { policyNumber: { contains: f.q } } },
        { policy: { naicomUid: { contains: f.q } } },
        { policy: { insuredName: { contains: f.q } } },
      ],
    });
  }
  return { AND: and };
}

const listInclude = {
  policy: { select: { id: true, policyNumber: true, insuredName: true, policyType: true, insurerName: true, brokerName: true, insurerOrgId: true } },
  assignedAdjuster: { select: { id: true, fullName: true } },
} satisfies Prisma.ClaimInclude;

type ListRow = Prisma.ClaimGetPayload<{ include: typeof listInclude }>;

/** Insurers see a claim's valuation figures only once it is settled; fees and adjuster workings never. */
function figuresFor(user: AuthUser, c: Pick<ListRow, "status" | "recommendedSettlement" | "settledAmount" | "adjusterFee" | "valueAtRisk" | "applyAverage">) {
  const staff = user.role !== "INSURER";
  const settled = c.status === "SETTLED";
  return {
    recommendedSettlement: staff || settled ? moneyOut(c.recommendedSettlement) : null,
    settledAmount: moneyOut(c.settledAmount),
    ...(staff ? { adjusterFee: moneyOut(c.adjusterFee), valueAtRisk: moneyOut(c.valueAtRisk), applyAverage: c.applyAverage } : {}),
  };
}

function listItem(user: AuthUser, c: ListRow) {
  const closed = CLOSED_STATUSES.includes(c.status);
  return {
    id: c.id,
    claimReference: c.claimReference,
    insurerClaimNo: c.insurerClaimNo,
    status: c.status,
    statusLabel: STATUS_LABEL[c.status],
    dateOfLoss: dateOut(c.dateOfLoss),
    dateInstructed: dateOut(c.dateInstructed),
    lossState: c.lossState,
    lossLga: c.lossLga,
    policy: c.policy,
    assignedAdjuster: c.assignedAdjuster,
    initialReserve: moneyOut(c.initialReserve),
    ...figuresFor(user, c),
    daysOpen: calendarDaysBetween(c.dateInstructed, closed && c.closedAt ? c.closedAt : new Date()),
    closedAt: c.closedAt?.toISOString() ?? null,
  };
}

export async function listClaims(user: AuthUser, q: ClaimListQuery) {
  const where = buildClaimWhere(user, q);
  const desc = q.sort.startsWith("-");
  const field = q.sort.replace(/^-/, "");
  const orderBy: Prisma.ClaimOrderByWithRelationInput[] = [{ [field]: desc ? "desc" : "asc" }, { id: "desc" }];
  const [total, rows] = await Promise.all([
    prisma.claim.count({ where }),
    prisma.claim.findMany({ where, include: listInclude, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { data: rows.map((r) => listItem(user, r)), meta: { page: q.page, pageSize: q.pageSize, total } };
}

/** A claim the caller may see, else 404 (missing and out-of-scope look the same). */
export async function findScopedClaim(user: AuthUser, id: number, tx: Tx | typeof prisma = prisma) {
  const claim = await tx.claim.findFirst({ where: { AND: [{ id }, claimScope(user)] } });
  if (!claim) throw notFound("Claim");
  return claim;
}

export async function loadSlaTargets() {
  return prisma.slaTarget.findMany();
}

export async function getClaim(user: AuthUser, id: number) {
  await findScopedClaim(user, id);
  const c = await prisma.claim.findUniqueOrThrow({
    where: { id },
    include: {
      policy: true,
      assignedAdjuster: { select: { id: true, fullName: true, email: true, phone: true, naicomLicenseNo: true, ciiQualification: true } },
      statusHistory: { orderBy: { changedAt: "asc" }, include: { changedBy: { select: { id: true, fullName: true } } } },
      inspections: { where: { deletedAt: null }, orderBy: { scheduledDate: "asc" }, select: { id: true, scheduledDate: true, completedDate: true } },
    },
  });
  const staff = user.role !== "INSURER";
  const sla = computeSla(
    { dateInstructed: c.dateInstructed, status: c.status, history: c.statusHistory, inspections: c.inspections },
    await loadSlaTargets(),
  );

  const warnings: string[] = [];
  if (c.dateOfLoss < c.policy.startDate || c.dateOfLoss > c.policy.endDate) {
    warnings.push("The date of loss is outside the policy period.");
  }

  const allowedTransitions =
    user.role === "INSURER"
      ? []
      : CLAIM_TRANSITIONS.filter((t) => t.from.includes(c.status) && t.roles.includes(user.role)).map((t) => ({
          to: t.to,
          label: t.label,
          reasonRequired: !!t.reasonRequired,
          settledAmountRequired: !!t.settledAmountRequired,
        }));

  return {
    id: c.id,
    claimReference: c.claimReference,
    insurerClaimNo: c.insurerClaimNo,
    status: c.status,
    statusLabel: STATUS_LABEL[c.status],
    dateOfLoss: dateOut(c.dateOfLoss),
    dateInstructed: dateOut(c.dateInstructed),
    lossState: c.lossState,
    lossLga: c.lossLga,
    lossAddress: c.lossAddress,
    incidentDescription: c.incidentDescription,
    initialReserve: moneyOut(c.initialReserve),
    ...figuresFor(user, c),
    repudiationReason: c.repudiationReason,
    closedAt: c.closedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    policy: policyOut(c.policy),
    assignedAdjuster: c.assignedAdjuster,
    // Insurers see the milestones, not who moved them or internal return reasons.
    timeline: c.statusHistory.map((h) => ({
      id: h.id,
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      label: STATUS_LABEL[h.toStatus],
      changedAt: h.changedAt.toISOString(),
      ...(staff ? { changedBy: h.changedBy, reason: h.reason } : { reason: h.toStatus === "REPUDIATED" ? h.reason : null }),
    })),
    inspections: {
      total: c.inspections.length,
      completed: c.inspections.filter((i) => i.completedDate).length,
      nextScheduled: c.inspections.find((i) => !i.completedDate)?.scheduledDate.toISOString() ?? null,
    },
    sla,
    warnings,
    allowedTransitions,
    permissions: {
      edit: staff && !CLOSED_STATUSES.includes(c.status),
      assign: user.role === "ADMIN" && !CLOSED_STATUSES.includes(c.status),
      delete: user.role === "ADMIN" && c.status === "NEW_INSTRUCTION",
    },
  };
}

async function requireActiveAdjuster(tx: Tx, id: number) {
  const adjuster = await tx.user.findUnique({ where: { id }, select: { id: true, role: true, isActive: true, fullName: true } });
  if (!adjuster || adjuster.role !== "ADJUSTER" || !adjuster.isActive) throw badRequest("Pick an active loss adjuster.");
  return adjuster;
}

/** Log a new instruction: policy (existing or new), claim with its LA-YYYY-NNNN reference, first status, audit. */
export async function intake(actor: AuthUser, input: IntakeInput, ip: string | null) {
  if (input.dateInstructed > todayLagos()) throw badRequest("The instruction date can't be in the future.");

  // Possible duplicate: an open claim on the same policy for the same date of loss.
  if (input.policyId && !input.confirmDuplicate) {
    const dupes = await prisma.claim.findMany({
      where: { policyId: input.policyId, dateOfLoss: dateIn(input.dateOfLoss), status: { in: OPEN_STATUSES } },
      select: { id: true, claimReference: true },
    });
    if (dupes.length) {
      throw new AppError(409, "DUPLICATE_SUSPECTED", `This policy already has an open claim for a loss on ${input.dateOfLoss} (${dupes.map((d) => d.claimReference).join(", ")}). Log it anyway?`, { claims: dupes });
    }
  }

  const year = Number(input.dateInstructed.slice(0, 4));
  const created = await prisma.$transaction(async (tx) => {
    const policy = input.policy
      ? await createPolicyTx(tx, actor, input.policy, ip)
      : await tx.policy.findUnique({ where: { id: input.policyId! } });
    if (!policy) throw badRequest("That policy does not exist.");
    if (input.assignedAdjusterId) await requireActiveAdjuster(tx, input.assignedAdjusterId);

    const claimReference = await allocateClaimReference(tx, year);
    const claim = await tx.claim.create({
      data: {
        claimReference,
        policyId: policy.id,
        assignedAdjusterId: input.assignedAdjusterId ?? null,
        insurerClaimNo: input.insurerClaimNo ?? null,
        dateOfLoss: dateIn(input.dateOfLoss),
        dateInstructed: dateIn(input.dateInstructed),
        lossState: input.lossState,
        lossLga: input.lossLga ?? null,
        lossAddress: input.lossAddress,
        incidentDescription: input.incidentDescription,
        initialReserve: input.initialReserve,
        valueAtRisk: input.valueAtRisk ?? null,
        applyAverage: input.applyAverage ?? AVERAGE_BY_DEFAULT.has(policy.policyType),
      },
    });
    await tx.claimStatusHistory.create({ data: { claimId: claim.id, fromStatus: null, toStatus: "NEW_INSTRUCTION", changedById: actor.id } });
    await recordAudit(
      {
        action: "CLAIM_INSTRUCTED",
        entityType: "Claim",
        entityId: claim.id,
        claimId: claim.id,
        userId: actor.id,
        details: { claimReference, policyId: policy.id, assignedAdjusterId: claim.assignedAdjusterId, duplicateConfirmed: !!input.confirmDuplicate },
        ipAddress: ip,
      },
      tx,
    );
    return claim;
  });
  return getClaim(actor, created.id);
}

const UPDATE_FIELDS = ["insurerClaimNo", "dateOfLoss", "dateInstructed", "lossState", "lossLga", "lossAddress", "incidentDescription", "initialReserve", "valueAtRisk", "applyAverage", "adjusterFee"] as const;

export async function updateClaim(actor: AuthUser, id: number, input: ClaimUpdate, ip: string | null) {
  if (actor.role === "INSURER") throw forbidden();
  const given = Object.entries(input).filter(([, v]) => v !== undefined).map(([k]) => k as keyof ClaimUpdate);
  if (actor.role === "ADJUSTER") {
    const blocked = given.filter((k) => !ADJUSTER_EDITABLE.includes(k));
    if (blocked.length) throw forbidden(`Only the principal adjuster can change: ${blocked.join(", ")}.`);
  }
  await prisma.$transaction(async (tx) => {
    const before = await findScopedClaim(actor, id, tx);
    if (CLOSED_STATUSES.includes(before.status)) throw unprocessable("This claim is closed. Reopen it before making changes.");
    if (before.status === "PENDING_SIGNOFF" && (input.valueAtRisk !== undefined || input.applyAverage !== undefined)) {
      throw unprocessable("The figures are with the principal for sign-off. Return the claim to change the value at risk or average.");
    }
    const dateOfLoss = input.dateOfLoss ?? dateOut(before.dateOfLoss)!;
    const dateInstructed = input.dateInstructed ?? dateOut(before.dateInstructed)!;
    if (dateOfLoss > dateInstructed) throw badRequest("The date of loss can't be after the instruction date.");
    if (dateInstructed > todayLagos()) throw badRequest("The instruction date can't be in the future.");
    const after = await tx.claim.update({
      where: { id },
      data: {
        ...input,
        dateOfLoss: input.dateOfLoss ? dateIn(input.dateOfLoss) : undefined,
        dateInstructed: input.dateInstructed ? dateIn(input.dateInstructed) : undefined,
      },
    });
    const changes = diffRecords(before, after, [...UPDATE_FIELDS]);
    if (changes.valueAtRisk || changes.applyAverage) await recomputeSettlement(tx, id);
    if (Object.keys(changes).length) {
      await recordAudit({ action: "CLAIM_UPDATED", entityType: "Claim", entityId: id, claimId: id, userId: actor.id, details: { changes }, ipAddress: ip }, tx);
    }
  });
  return getClaim(actor, id);
}

export async function assignAdjuster(actor: AuthUser, id: number, adjusterId: number | null, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    const claim = await findScopedClaim(actor, id, tx);
    if (CLOSED_STATUSES.includes(claim.status)) throw unprocessable("This claim is closed. Reopen it before reassigning.");
    if (adjusterId == null && claim.status !== "NEW_INSTRUCTION") {
      throw unprocessable("A claim already in progress must stay with an adjuster. Pick another adjuster instead.");
    }
    if (adjusterId != null) await requireActiveAdjuster(tx, adjusterId);
    if (claim.assignedAdjusterId === adjusterId) return;
    await tx.claim.update({ where: { id }, data: { assignedAdjusterId: adjusterId } });
    await recordAudit(
      { action: "CLAIM_ASSIGNED", entityType: "Claim", entityId: id, claimId: id, userId: actor.id, details: { changes: { assignedAdjusterId: { from: claim.assignedAdjusterId, to: adjusterId } } }, ipAddress: ip },
      tx,
    );
  });
  return getClaim(actor, id);
}

export interface MoveOptions {
  reason?: string;
  settledAmount?: string;
  ipAddress?: string | null;
}

/**
 * Moves a claim's status inside the caller's transaction: checks the move is in CLAIM_TRANSITIONS, the caller's
 * role, an assigned adjuster, the reason/amount the move needs; updates only if the status is still what was
 * read (409 otherwise); writes history and audit. Later phases call this from their own actions.
 */
export async function moveClaimStatus(tx: Tx, actor: AuthUser, claimId: number, to: ClaimStatus, opts: MoveOptions = {}) {
  const claim = await findScopedClaim(actor, claimId, tx);
  const t = findTransition(claim.status, to);
  if (!t) {
    const allowed = CLAIM_TRANSITIONS.filter((x) => x.from.includes(claim.status)).map((x) => STATUS_LABEL[x.to]);
    throw conflict(`A claim that is "${STATUS_LABEL[claim.status]}" can't move to "${STATUS_LABEL[to]}".`, { allowed });
  }
  if (!t.roles.includes(actor.role)) throw forbidden(`Only the principal adjuster can ${t.label.toLowerCase()}.`);
  if (to !== "REPUDIATED" && !CLOSED_STATUSES.includes(claim.status) && claim.assignedAdjusterId == null) {
    throw unprocessable("Assign a loss adjuster first.");
  }
  const reason = opts.reason?.trim() || null;
  if (t.reasonRequired && !reason) throw badRequest("Give a reason for this change.");
  if (t.settledAmountRequired && !opts.settledAmount) throw badRequest("Enter the amount the claim was settled for.");

  const data: Prisma.ClaimUpdateManyMutationInput = { status: to };
  if (to === "SETTLED") Object.assign(data, { settledAmount: opts.settledAmount, closedAt: new Date() });
  if (to === "REPUDIATED") Object.assign(data, { repudiationReason: reason, closedAt: new Date() });
  if (CLOSED_STATUSES.includes(claim.status)) Object.assign(data, { closedAt: null, settledAmount: null, repudiationReason: null });

  const { count } = await tx.claim.updateMany({ where: { id: claimId, status: claim.status }, data });
  if (count !== 1) throw conflict("Someone else changed this claim's status just now. Refresh and try again.");
  await tx.claimStatusHistory.create({ data: { claimId, fromStatus: claim.status, toStatus: to, changedById: actor.id, reason } });
  await recordAudit(
    {
      action: "CLAIM_STATUS_CHANGED",
      entityType: "Claim",
      entityId: claimId,
      claimId,
      userId: actor.id,
      details: { changes: { status: { from: claim.status, to } }, reason, ...(opts.settledAmount ? { settledAmount: opts.settledAmount } : {}) },
      ipAddress: opts.ipAddress ?? null,
    },
    tx,
  );
}

export async function transition(actor: AuthUser, id: number, to: ClaimStatus, opts: MoveOptions) {
  await prisma.$transaction((tx) => moveClaimStatus(tx, actor, id, to, opts));
  return getClaim(actor, id);
}

/** Only a mistaken instruction (still NEW_INSTRUCTION) can be removed; it is soft-deleted, never erased. */
export async function deleteClaim(actor: AuthUser, id: number, reason: string, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    const claim = await findScopedClaim(actor, id, tx);
    if (claim.status !== "NEW_INSTRUCTION") throw unprocessable("Only a new instruction can be deleted. Repudiate or settle a claim in progress instead.");
    await tx.claim.update({ where: { id }, data: { deletedAt: new Date() } });
    await recordAudit({ action: "CLAIM_DELETED", entityType: "Claim", entityId: id, claimId: id, userId: actor.id, details: { claimReference: claim.claimReference, reason }, ipAddress: ip }, tx);
  });
}

/** Choices for filters and forms, limited to what the caller may see. */
export async function claimOptions(user: AuthUser) {
  const staff = user.role !== "INSURER";
  const [adjusters, insurers, brokers] = await Promise.all([
    staff ? prisma.user.findMany({ where: { role: "ADJUSTER", isActive: true }, select: { id: true, fullName: true, ciiQualification: true }, orderBy: { fullName: "asc" } }) : [],
    staff ? prisma.organisation.findMany({ where: { type: "INSURER" }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
    user.role === "ADMIN" ? prisma.organisation.findMany({ where: { type: "BROKER" }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
  ]);
  return {
    statuses: Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
    lines: Object.entries(LINES).map(([value, l]) => ({ value, label: l.label })),
    policyTypes: POLICY_TYPE_LABELS,
    states: NIGERIAN_STATES,
    adjusters,
    insurers,
    brokers,
  };
}

/**
 * For writes to a claim's sub-records (inspections, evidence, schedule of loss): the claim must be in the caller's
 * scope (404), the caller staff (403) and the claim open (422). `lockedAt` adds statuses where the record is frozen.
 */
export async function claimForStaffWrite(actor: AuthUser, claimId: number, tx: Tx | typeof prisma = prisma, lockedAt: ClaimStatus[] = []) {
  if (actor.role === "INSURER") throw forbidden();
  const claim = await findScopedClaim(actor, claimId, tx);
  if (CLOSED_STATUSES.includes(claim.status)) throw unprocessable("This claim is closed. Reopen it before making changes.");
  if (lockedAt.includes(claim.status)) {
    throw unprocessable(`The claim is "${STATUS_LABEL[claim.status]}", so this can't change now. The principal adjuster can return it to make changes.`);
  }
  return claim;
}
