import { z } from "zod";
import type { Policy, Prisma } from "@prisma/client";
import { prisma, type Tx } from "../../lib/prisma.js";
import { diffRecords, recordAudit } from "../../lib/audit.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { dateIn, dateOut } from "../../lib/dates.js";
import { moneyOut } from "../../lib/money.js";
import { zDate, zMoney, zPercent, zRequiredText, zText } from "../../lib/validation.js";
import type { AuthUser } from "../../middleware/authenticate.js";

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
  excessAmount: zMoney.default("0.00"),
  excessPercentage: zPercent.default("0.00"),
  startDate: zDate,
  endDate: zDate,
});
const periodCheck = (p: { startDate?: string; endDate?: string }) => !p.startDate || !p.endDate || p.endDate >= p.startDate;
export const policyInput = policyFields.refine(periodCheck, { message: "The policy must end on or after its start date.", path: ["endDate"] });
export const policyUpdate = policyFields.partial().refine(periodCheck, { message: "The policy must end on or after its start date.", path: ["endDate"] });
export type PolicyInput = z.infer<typeof policyInput>;

export function policyOut(p: Policy) {
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
  };
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
  const policy = await tx.policy.create({
    data: {
      ...input,
      brokerOrgId: input.brokerOrgId ?? null,
      ...names,
      startDate: dateIn(input.startDate),
      endDate: dateIn(input.endDate),
    },
  });
  await recordAudit({ action: "POLICY_CREATED", entityType: "Policy", entityId: policy.id, userId: actor.id, details: { policyNumber: policy.policyNumber, naicomUid: policy.naicomUid }, ipAddress: ip }, tx);
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
  const rows = await prisma.policy.findMany({ where, orderBy: { createdAt: "desc" }, take: 50 });
  return rows.map(policyOut);
}

/** Intake lookup by NAICOM UID: the policy, if held, and its claims so a duplicate instruction stands out. */
export async function verifyPolicy(naicomUid: string) {
  const policy = await prisma.policy.findUnique({ where: { naicomUid: naicomUid.trim().toUpperCase() } });
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
  const p = await prisma.policy.findUnique({ where: { id } });
  if (!p) throw notFound("Policy");
  return policyOut(p);
}

const FIELDS = ["policyNumber", "naicomUid", "insurerOrgId", "brokerOrgId", "insuredName", "insuredContact", "policyType", "sumInsured", "excessAmount", "excessPercentage", "startDate", "endDate"] as const;

export async function updatePolicy(actor: AuthUser, id: number, input: z.infer<typeof policyUpdate>, ip: string | null) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.policy.findUnique({ where: { id } });
    if (!before) throw notFound("Policy");
    const start = input.startDate ?? dateOut(before.startDate)!;
    const end = input.endDate ?? dateOut(before.endDate)!;
    if (end < start) throw badRequest("The policy must end on or after its start date.");
    const insurerOrgId = input.insurerOrgId ?? before.insurerOrgId;
    const brokerOrgId = input.brokerOrgId !== undefined ? input.brokerOrgId : before.brokerOrgId;
    const names = await resolveOrgs(tx, insurerOrgId, brokerOrgId);
    const after = await tx.policy.update({
      where: { id },
      data: {
        ...input,
        brokerOrgId: brokerOrgId ?? null,
        ...names,
        startDate: dateIn(start),
        endDate: dateIn(end),
      },
    });
    const changes = diffRecords(before, after, [...FIELDS]);
    if (Object.keys(changes).length) {
      await recordAudit({ action: "POLICY_UPDATED", entityType: "Policy", entityId: id, userId: actor.id, details: { changes }, ipAddress: ip }, tx);
    }
    return policyOut(after);
  });
}
