import { z } from "zod";
import type { Policy, PolicyCoInsurer, Prisma } from "@prisma/client";
import { sharesComplete } from "../../lib/apportion.js";
import { prisma, type Tx } from "../../lib/prisma.js";
import { diffRecords, recordAudit } from "../../lib/audit.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { dateIn, dateOut } from "../../lib/dates.js";
import { moneyOut } from "../../lib/money.js";
import { zDate, zMoney, zPercent, zRequiredText, zText } from "../../lib/validation.js";
import type { AuthUser } from "../../middleware/authenticate.js";
import { recomputeSettlement } from "../valuation/settlementStore.js";

export const POLICY_TYPES = ["MOTOR", "PROPERTY_FIRE", "MARINE_CARGO", "OIL_AND_GAS", "ENGINEERING_CAR", "GENERAL_ACCIDENT"] as const;

const policyFields = z.object({
  policyNumber: zRequiredText(64),
  naicomUid: z.string().trim().toUpperCase().min(1, "Enter the NAICOM policy UID.").max(64),
  insurerOrgId: z.coerce.number({ message: "Pick the insurer." }).int().positive({ message: "Pick the insurer." }),
  brokerOrgId: z.coerce.number().int().positive().nullable().optional(),
  insuredName: zRequiredText(191),
  insuredContact: zText(255),
  policyType: z.enum(POLICY_TYPES, { message: "Pick the class of insurance." }),
  sumInsured: zMoney.refine((v) => Number(v) > 0, "Sum insured must be more than zero."),
  excessAmount: zMoney,
  excessPercentage: zPercent,
  startDate: zDate,
  endDate: zDate,
  /** The lead insurer's share; with the co-insurers it must add up to 100%. */
  leadSharePercent: zPercent,
  coInsurers: z
    .array(z.object({ organisationId: z.coerce.number({ message: "Pick the co-insurer." }).int().positive({ message: "Pick the co-insurer." }), sharePercent: zPercent }))
    .max(10, "At most ten co-insurers."),
});
// Defaults only when creating: on an update a missing field means "leave it as it is".
const policyCreateFields = policyFields.extend({
  excessAmount: zMoney.default("0.00"),
  excessPercentage: zPercent.default("0.00"),
  leadSharePercent: zPercent.default("100.00"),
  coInsurers: policyFields.shape.coInsurers.default([]),
});
const periodCheck = (p: { startDate?: string; endDate?: string }) => !p.startDate || !p.endDate || p.endDate >= p.startDate;
export const policyInput = policyCreateFields.refine(periodCheck, { message: "The policy must end on or after its start date.", path: ["endDate"] });
export const policyUpdate = policyFields.partial().refine(periodCheck, { message: "The policy must end on or after its start date.", path: ["endDate"] });
export type PolicyInput = z.infer<typeof policyInput>;

type CoInsurerInput = { organisationId: number; sharePercent: string };

export function policyOut(p: Policy & { coInsurers?: PolicyCoInsurer[] }) {
  return {
    id: p.id,
    policyNumber: p.policyNumber,
    naicomUid: p.naicomUid,
    insurerOrgId: p.insurerOrgId,
    brokerOrgId: p.brokerOrgId,
    insurerName: p.insurerName,
    brokerName: p.brokerName,
    insuredName: p.insuredName,
    insuredContact: p.insuredContact,
    policyType: p.policyType,
    sumInsured: moneyOut(p.sumInsured),
    excessAmount: moneyOut(p.excessAmount),
    excessPercentage: p.excessPercentage.toFixed(2),
    startDate: dateOut(p.startDate),
    endDate: dateOut(p.endDate),
    leadSharePercent: p.leadSharePercent.toFixed(2),
    coInsurers: (p.coInsurers ?? []).map((c) => ({ organisationId: c.organisationId, insurerName: c.insurerName, sharePercent: c.sharePercent.toFixed(2) })),
  };
}

const withCoInsurers = { coInsurers: { orderBy: { sortOrder: "asc" } } } as const;

/** Checks the co-insurance split and replaces the policy's co-insurers. Returns the rows for the audit entry. */
async function saveCoInsurers(tx: Tx, policyId: number, insurerOrgId: number, lead: string, list: CoInsurerInput[]) {
  if (!list.length && Number(lead) !== 100) throw badRequest("Without co-insurers the lead insurer's share is 100%.");
  if (list.length) {
    if (list.some((c) => c.organisationId === insurerOrgId)) throw badRequest("The lead insurer can't also be a co-insurer.");
    if (new Set(list.map((c) => c.organisationId)).size !== list.length) throw badRequest("A co-insurer is listed twice.");
    if ([lead, ...list.map((c) => c.sharePercent)].some((p) => Number(p) <= 0)) throw badRequest("Every share must be more than 0%.");
    if (!sharesComplete([lead, ...list.map((c) => c.sharePercent)])) throw badRequest("The lead's share and the co-insurers' shares must add up to 100%.");
  }
  const orgs = await tx.organisation.findMany({ where: { id: { in: list.map((c) => c.organisationId) }, type: "INSURER" } });
  if (orgs.length !== list.length) throw badRequest("Pick each co-insurer from the list of insurers.");
  await tx.policyCoInsurer.deleteMany({ where: { policyId } });
  await tx.policyCoInsurer.createMany({
    data: list.map((c, i) => ({ policyId, organisationId: c.organisationId, insurerName: orgs.find((o) => o.id === c.organisationId)!.name, sharePercent: c.sharePercent, sortOrder: i })),
  });
  return list.map((c) => `${orgs.find((o) => o.id === c.organisationId)!.name} ${Number(c.sharePercent)}%`).join(", ");
}

/** Checks the insurer/broker ids and returns the names printed on the policy. */
async function resolveOrgs(tx: Tx, insurerOrgId: number, brokerOrgId: number | null | undefined) {
  const insurer = await tx.organisation.findUnique({ where: { id: insurerOrgId } });
  if (!insurer || insurer.type !== "INSURER") throw badRequest("Pick an insurer from the list.");
  let broker = null;
  if (brokerOrgId) {
    broker = await tx.organisation.findUnique({ where: { id: brokerOrgId } });
    if (!broker || broker.type !== "BROKER") throw badRequest("Pick a broker from the list.");
  }
  return { insurerName: insurer.name, brokerName: broker?.name ?? null };
}

/** Creates a policy inside the caller's transaction (used by intake as well as POST /policies). */
export async function createPolicyTx(tx: Tx, actor: AuthUser, input: PolicyInput, ip: string | null) {
  const names = await resolveOrgs(tx, input.insurerOrgId, input.brokerOrgId);
  const { coInsurers, ...fields } = input;
  const created = await tx.policy.create({
    data: {
      ...fields,
      brokerOrgId: input.brokerOrgId ?? null,
      ...names,
      startDate: dateIn(input.startDate),
      endDate: dateIn(input.endDate),
    },
  });
  const coInsurance = await saveCoInsurers(tx, created.id, created.insurerOrgId, input.leadSharePercent, coInsurers);
  const policy = await tx.policy.findUniqueOrThrow({ where: { id: created.id }, include: withCoInsurers });
  await recordAudit({ action: "POLICY_CREATED", entityType: "Policy", entityId: policy.id, userId: actor.id, details: { policyNumber: policy.policyNumber, naicomUid: policy.naicomUid, ...(coInsurance ? { coInsurance, leadSharePercent: input.leadSharePercent } : {}) }, ipAddress: ip }, tx);
  return policy;
}

export async function createPolicy(actor: AuthUser, input: PolicyInput, ip: string | null) {
  return policyOut(await prisma.$transaction((tx) => createPolicyTx(tx, actor, input, ip)));
}

export async function listPolicies(filters: { q?: string; insurerOrgId?: number }) {
  const where: Prisma.PolicyWhereInput = {
    ...(filters.insurerOrgId ? { insurerOrgId: filters.insurerOrgId } : {}),
    ...(filters.q
      ? { OR: [{ policyNumber: { contains: filters.q } }, { naicomUid: { contains: filters.q } }, { insuredName: { contains: filters.q } }] }
      : {}),
  };
  const rows = await prisma.policy.findMany({ where, orderBy: { createdAt: "desc" }, take: 50, include: withCoInsurers });
  return rows.map(policyOut);
}

/** Intake lookup by NAICOM UID: the policy, if held, and its claims so a duplicate instruction stands out. */
export async function verifyPolicy(naicomUid: string) {
  const policy = await prisma.policy.findUnique({ where: { naicomUid: naicomUid.trim().toUpperCase() }, include: withCoInsurers });
  if (!policy) return { found: false as const };
  const claims = await prisma.claim.findMany({
    where: { policyId: policy.id },
    select: { id: true, claimReference: true, dateOfLoss: true, status: true },
    orderBy: { dateOfLoss: "desc" },
  });
  return {
    found: true as const,
    policy: policyOut(policy),
    claims: claims.map((c) => ({ ...c, dateOfLoss: dateOut(c.dateOfLoss) })),
  };
}

export async function getPolicy(id: number) {
  const p = await prisma.policy.findUnique({ where: { id }, include: withCoInsurers });
  if (!p) throw notFound("Policy");
  return policyOut(p);
}

const FIELDS = ["policyNumber", "naicomUid", "insurerOrgId", "brokerOrgId", "insuredName", "insuredContact", "policyType", "sumInsured", "excessAmount", "excessPercentage", "startDate", "endDate", "leadSharePercent"] as const;

export async function updatePolicy(actor: AuthUser, id: number, input: z.infer<typeof policyUpdate>, ip: string | null) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.policy.findUnique({ where: { id }, include: withCoInsurers });
    if (!before) throw notFound("Policy");
    const start = input.startDate ?? dateOut(before.startDate)!;
    const end = input.endDate ?? dateOut(before.endDate)!;
    if (end < start) throw badRequest("The policy must end on or after its start date.");
    const insurerOrgId = input.insurerOrgId ?? before.insurerOrgId;
    const brokerOrgId = input.brokerOrgId !== undefined ? input.brokerOrgId : before.brokerOrgId;
    const names = await resolveOrgs(tx, insurerOrgId, brokerOrgId);
    const { coInsurers, ...fields } = input;
    const after = await tx.policy.update({
      where: { id },
      data: {
        ...fields,
        brokerOrgId: brokerOrgId ?? null,
        ...names,
        startDate: dateIn(start),
        endDate: dateIn(end),
      },
    });
    const changes: Record<string, unknown> = diffRecords(before, after, [...FIELDS]);
    if (coInsurers !== undefined || input.leadSharePercent !== undefined || input.insurerOrgId !== undefined) {
      const list = coInsurers ?? before.coInsurers.map((c) => ({ organisationId: c.organisationId, sharePercent: c.sharePercent.toFixed(2) }));
      const from = before.coInsurers.map((c) => `${c.insurerName} ${Number(c.sharePercent)}%`).join(", ");
      const to = await saveCoInsurers(tx, id, after.insurerOrgId, after.leadSharePercent.toFixed(2), list);
      if (from !== to) changes.coInsurers = { from: from || null, to: to || null };
    }
    // Sum insured and excess feed every open claim's settlement on this policy.
    if (changes.sumInsured || changes.excessAmount || changes.excessPercentage) {
      const open = await tx.claim.findMany({ where: { policyId: id, status: { notIn: ["SETTLED", "REPUDIATED"] } }, select: { id: true } });
      for (const c of open) await recomputeSettlement(tx, c.id);
    }
    if (Object.keys(changes).length) {
      await recordAudit({ action: "POLICY_UPDATED", entityType: "Policy", entityId: id, userId: actor.id, details: { changes } as Prisma.InputJsonValue, ipAddress: ip }, tx);
    }
    return policyOut(await tx.policy.findUniqueOrThrow({ where: { id }, include: withCoInsurers }));
  });
}
