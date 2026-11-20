import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { recordAudit } from "../../lib/audit.js";
import { unauthorized } from "../../lib/errors.js";
import { hashRefreshToken, newRefreshToken, signAccessToken } from "./tokens.js";

// Compared against when the email is unknown, so a wrong email and a wrong password take the same time.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);
// A refresh token used again this soon after rotation is treated as two tabs racing, not as theft.
const REUSE_GRACE_MS = 10_000;

export interface PublicUser {
  id: number;
  fullName: string;
  email: string;
  role: Role;
  phone: string | null;
  naicomLicenseNo: string | null;
  ciiQualification: string | null;
  organisation: { id: number; name: string; type: string } | null;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: PublicUser;
}

const publicUserSelect = {
  id: true,
  fullName: true,
  email: true,
  role: true,
  phone: true,
  naicomLicenseNo: true,
  ciiQualification: true,
  organisation: { select: { id: true, name: true, type: true } },
} as const;

export async function getPublicUser(id: number): Promise<PublicUser | null> {
  return prisma.user.findUnique({ where: { id }, select: publicUserSelect });
}

async function issueSession(userId: number): Promise<Session> {
  const refresh = newRefreshToken();
  await prisma.refreshToken.create({ data: { userId, tokenHash: refresh.hash, expiresAt: refresh.expiresAt } });
  const user = await getPublicUser(userId);
  if (!user) throw unauthorized();
  return { accessToken: signAccessToken(userId), refreshToken: refresh.raw, refreshExpiresAt: refresh.expiresAt, user };
}

export async function login(email: string, password: string, ipAddress: string | null): Promise<Session> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, isActive: true },
  });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok || !user.isActive) {
    if (user) {
      await recordAudit({
        action: "LOGIN_FAILED",
        entityType: "User",
        entityId: user.id,
        userId: user.id,
        details: { reason: ok ? "inactive" : "bad_password" },
        ipAddress,
      });
    }
    // Same message whatever the cause, so the form can't be used to find which emails exist.
    throw unauthorized("Incorrect email or password.");
  }
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await recordAudit({ action: "LOGIN", entityType: "User", entityId: user.id, userId: user.id, ipAddress });
  return issueSession(user.id);
}

/** Exchange a refresh token for a new pair (rotation). Reusing a rotated token revokes all the user's sessions. */
export async function refresh(raw: string | undefined, ipAddress: string | null): Promise<Session> {
  if (!raw) throw unauthorized();
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(raw) } });
  if (!stored) throw unauthorized();

  if (stored.revokedAt) {
    if (Date.now() - stored.revokedAt.getTime() > REUSE_GRACE_MS && stored.replacedById != null) {
      await prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await recordAudit({
        action: "REFRESH_TOKEN_REUSE",
        entityType: "User",
        entityId: stored.userId,
        userId: stored.userId,
        details: { note: "A rotated refresh token was used again; every session for this user was signed out." },
        ipAddress,
      });
    }
    throw unauthorized();
  }
  if (stored.expiresAt.getTime() <= Date.now()) throw unauthorized("Your session has expired. Please sign in again.");

  const user = await prisma.user.findUnique({ where: { id: stored.userId }, select: { isActive: true } });
  if (!user?.isActive) throw unauthorized();

  const next = newRefreshToken();
  const rotated = await prisma.$transaction(async (tx) => {
    const created = await tx.refreshToken.create({
      data: { userId: stored.userId, tokenHash: next.hash, expiresAt: next.expiresAt },
    });
    // Conditional: if another request rotated this token first, ours loses and the new row is rolled back.
    const { count } = await tx.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date(), replacedById: created.id },
    });
    if (count !== 1) throw unauthorized();
    return created;
  });
  const publicUser = await getPublicUser(stored.userId);
  if (!publicUser) throw unauthorized();
  return {
    accessToken: signAccessToken(stored.userId),
    refreshToken: next.raw,
    refreshExpiresAt: rotated.expiresAt,
    user: publicUser,
  };
}

export async function logout(raw: string | undefined, userId: number | null, ipAddress: string | null) {
  if (raw) {
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hashRefreshToken(raw), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  if (userId != null) await recordAudit({ action: "LOGOUT", entityType: "User", entityId: userId, userId, ipAddress });
}
