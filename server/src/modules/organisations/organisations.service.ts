import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { diffRecords, recordAudit } from "../../lib/audit.js";
import { notFound } from "../../lib/errors.js";
import { zRequiredText, zText } from "../../lib/validation.js";
import type { AuthUser } from "../../middleware/authenticate.js";

export const organisationInput = z.object({
  name: zRequiredText(191),
  type: z.enum(["INSURER", "BROKER"]),
  naicomLicenceNo: zText(64),
  email: z.union([z.literal(""), z.email("Enter a valid email address.")]).nullable().optional().transform((v) => v || null),
  phone: zText(32),
  address: zText(500),
});
export const organisationUpdate = organisationInput.partial();

const FIELDS = ["name", "type", "naicomLicenceNo", "email", "phone", "address"] as const;

export async function listOrganisations(type?: "INSURER" | "BROKER") {
  const rows = await prisma.organisation.findMany({
    where: type ? { type } : {},
    orderBy: [{ type: "asc" }, { name: "asc" }],
    include: { _count: { select: { users: { where: { deletedAt: null } }, insurerPolicies: true, brokerPolicies: true } } },
  });
  return rows.map(({ _count, createdAt, updatedAt, deletedAt: _d, ...o }) => ({
    ...o,
    userCount: _count.users,
    policyCount: _count.insurerPolicies + _count.brokerPolicies,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  }));
}

export async function createOrganisation(actor: AuthUser, data: z.infer<typeof organisationInput>, ip: string | null) {
  return prisma.$transaction(async (tx) => {
    const org = await tx.organisation.create({ data });
    await recordAudit({ action: "ORGANISATION_CREATED", entityType: "Organisation", entityId: org.id, userId: actor.id, details: { name: org.name, type: org.type }, ipAddress: ip }, tx);
    return org;
  });
}

export async function updateOrganisation(actor: AuthUser, id: number, data: z.infer<typeof organisationUpdate>, ip: string | null) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.organisation.findUnique({ where: { id } });
    if (!before) throw notFound("Organisation");
    const after = await tx.organisation.update({ where: { id }, data });
    // Policies print the insurer/broker name as text; keep it in step with a rename.
    if (data.name && data.name !== before.name) {
      if (before.type === "INSURER") await tx.policy.updateMany({ where: { insurerOrgId: id }, data: { insurerName: data.name } });
      else await tx.policy.updateMany({ where: { brokerOrgId: id }, data: { brokerName: data.name } });
    }
    const changes = diffRecords(before, after, [...FIELDS]);
    if (Object.keys(changes).length) {
      await recordAudit({ action: "ORGANISATION_UPDATED", entityType: "Organisation", entityId: id, userId: actor.id, details: { changes }, ipAddress: ip }, tx);
    }
    return after;
  });
}
