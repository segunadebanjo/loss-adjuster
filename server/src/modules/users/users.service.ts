import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Prisma, Role } from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { diffRecords, recordAudit } from "../../lib/audit.js";
import { badRequest, conflict, notFound, unprocessable } from "../../lib/errors.js";
import { OPEN_STATUSES } from "../../lib/claimWorkflow.js";
import { zRequiredText, zText } from "../../lib/validation.js";
import type { AuthUser } from "../../middleware/authenticate.js";

const zPassword = z.string().min(10, "Use at least 10 characters.").max(200);

const base = z.object({
  fullName: zRequiredText(191),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
  role: z.enum(["ADMIN", "ADJUSTER", "INSURER"]),
  phone: zText(32),
  naicomLicenseNo: zText(64),
  ciiQualification: zText(64),
  organisationId: z.coerce.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),
});
export const userCreate = base.extend({ password: zPassword });
export const userUpdate = base.partial();
export const passwordInput = z.object({ password: zPassword });

const FIELDS = ["fullName", "email", "role", "phone", "naicomLicenseNo", "ciiQualification", "organisationId", "isActive"] as const;

const select = {
  id: true,
  fullName: true,
  email: true,
  role: true,
  phone: true,
  naicomLicenseNo: true,
  ciiQualification: true,
  organisationId: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  organisation: { select: { id: true, name: true, type: true } },
} satisfies Prisma.UserSelect;

async function openClaimCount(userId: number) {
  return prisma.claim.count({ where: { assignedAdjusterId: userId, status: { in: OPEN_STATUSES } } });
}

/** INSURER users belong to an organisation; staff don't. */
async function checkOrganisation(role: Role, organisationId: number | null | undefined) {
  if (role === "INSURER") {
    if (!organisationId) throw badRequest("Pick the insurer or broker this user works for.");
    const org = await prisma.organisation.findUnique({ where: { id: organisationId } });
    if (!org) throw badRequest("That organisation does not exist.");
  } else if (organisationId) {
    throw badRequest("Only insurer/broker users belong to an organisation.");
  }
}

export async function listUsers(filters: { role?: Role; active?: boolean; q?: string }) {
  const where: Prisma.UserWhereInput = {
    ...(filters.role ? { role: filters.role } : {}),
    ...(filters.active !== undefined ? { isActive: filters.active } : {}),
    ...(filters.q ? { OR: [{ fullName: { contains: filters.q } }, { email: { contains: filters.q } }] } : {}),
  };
  const users = await prisma.user.findMany({ where, select, orderBy: [{ role: "asc" }, { fullName: "asc" }] });
  const counts = await prisma.claim.groupBy({
    by: ["assignedAdjusterId"],
    where: { status: { in: OPEN_STATUSES }, assignedAdjusterId: { in: users.map((u) => u.id) } },
    _count: { _all: true },
  });
  const byUser = new Map(counts.map((c) => [c.assignedAdjusterId, c._count._all]));
  return users.map((u) => ({
    ...u,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    openClaims: byUser.get(u.id) ?? 0,
  }));
}

export async function createUser(actor: AuthUser, input: z.infer<typeof userCreate>, ip: string | null) {
  await checkOrganisation(input.role, input.organisationId);
  const { password, ...data } = input;
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_COST);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { ...data, organisationId: data.organisationId ?? null, passwordHash }, select });
    await recordAudit({ action: "USER_CREATED", entityType: "User", entityId: user.id, userId: actor.id, details: { email: user.email, role: user.role }, ipAddress: ip }, tx);
    return user;
  });
}

export async function updateUser(actor: AuthUser, id: number, input: z.infer<typeof userUpdate>, ip: string | null) {
  const before = await prisma.user.findUnique({ where: { id }, select });
  if (!before) throw notFound("User");
  const role = input.role ?? before.role;
  const organisationId = input.organisationId !== undefined ? input.organisationId : before.organisationId;
  const deactivating = input.isActive === false && before.isActive;
  const leavingAdjuster = before.role === "ADJUSTER" && role !== "ADJUSTER";

  if (id === actor.id && (role !== before.role || input.isActive === false)) {
    throw unprocessable("You can't change your own role or deactivate yourself. Ask another administrator.");
  }
  if (role !== before.role || input.organisationId !== undefined) {
    await checkOrganisation(role, role === "INSURER" ? organisationId : (input.organisationId ?? null));
  }
  if (deactivating || leavingAdjuster) {
    const open = await openClaimCount(id);
    if (open > 0) {
      throw conflict(`${before.fullName} still has ${open} open claim${open === 1 ? "" : "s"}. Reassign them first.`, { openClaims: open });
    }
  }

  return prisma.$transaction(async (tx) => {
    const after = await tx.user.update({
      where: { id },
      data: { ...input, organisationId: role === "INSURER" ? organisationId : null },
      select,
    });
    if (deactivating || role !== before.role) {
      // Signed-in sessions end at once; access tokens already re-check the user on every request.
      await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    const changes = diffRecords(before, after, [...FIELDS]);
    if (Object.keys(changes).length) {
      await recordAudit({ action: "USER_UPDATED", entityType: "User", entityId: id, userId: actor.id, details: { changes }, ipAddress: ip }, tx);
    }
    return after;
  });
}

export async function setPassword(actor: AuthUser, id: number, password: string, ip: string | null) {
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!user) throw notFound("User");
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_COST);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { passwordHash } });
    await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await recordAudit({ action: "USER_PASSWORD_SET", entityType: "User", entityId: id, userId: actor.id, ipAddress: ip }, tx);
  });
}
