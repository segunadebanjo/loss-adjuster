/**
 * Runs before the server on every production start (npm run start:prod):
 *   - LOAD_DEMO_DATA=true loads the fictional demo data, but only while the database has no users
 *     (every demo password is SEED_PASSWORD).
 *   - ADMIN_EMAIL + ADMIN_PASSWORD make sure that email is an active Principal Adjuster (ADMIN) with that password:
 *     the account is created if missing, otherwise reactivated, made ADMIN and given the password. Use it for the first
 *     login or to recover a locked-out principal, then remove ADMIN_PASSWORD from the settings (while it is set, it
 *     wins over a password changed in the app on every restart).
 * Nothing else is ever changed, so neither option can wipe real data.
 */
import { spawnSync } from "node:child_process";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

// The raw client (no soft-delete filter), so a removed account with the admin email is found and restored.
const prisma = new PrismaClient();

async function loadDemoData() {
  if (process.env.LOAD_DEMO_DATA !== "true") return;
  if ((await prisma.user.count()) > 0) return;
  console.log("Empty database: loading the demo data (LOAD_DEMO_DATA=true).");
  const run = spawnSync("npx", ["tsx", "prisma/seed.ts"], {
    stdio: "inherit",
    env: { ...process.env, SEED_IN_PRODUCTION: "empty-database" },
  });
  if (run.status !== 0) throw new Error("Loading the demo data failed.");
}

async function ensureAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email && !password) return;
  if (!email || !password) throw new Error("Set both ADMIN_EMAIL and ADMIN_PASSWORD, or neither.");
  if (password.length < 10) throw new Error("ADMIN_PASSWORD must be at least 10 characters.");

  const fullName = process.env.ADMIN_NAME?.trim() || "Principal Adjuster";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    const user = await prisma.user.create({
      data: {
        fullName,
        email,
        passwordHash: await bcrypt.hash(password, Number(process.env.BCRYPT_COST ?? 12)),
        role: "ADMIN",
        isActive: true,
      },
    });
    await prisma.auditLog.create({
      data: { userId: user.id, action: "ADMIN_SET_FROM_SETTINGS", entityType: "User", entityId: user.id, details: { created: true } },
    });
    console.log(`Created the Principal Adjuster ${email} from ADMIN_EMAIL. Remove ADMIN_PASSWORD from the settings now.`);
    return;
  }

  const passwordMatches = await bcrypt.compare(password, existing.passwordHash);
  const ok = passwordMatches && existing.role === "ADMIN" && existing.isActive && !existing.deletedAt;
  if (ok) return;
  await prisma.$transaction([
    prisma.user.update({
      where: { id: existing.id },
      data: {
        role: "ADMIN",
        isActive: true,
        deletedAt: null,
        organisationId: null,
        ...(passwordMatches ? {} : { passwordHash: await bcrypt.hash(password, Number(process.env.BCRYPT_COST ?? 12)) }),
      },
    }),
    prisma.refreshToken.updateMany({ where: { userId: existing.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.auditLog.create({
      data: {
        userId: existing.id,
        action: "ADMIN_SET_FROM_SETTINGS",
        entityType: "User",
        entityId: existing.id,
        details: {
          role: { from: existing.role, to: "ADMIN" },
          isActive: { from: existing.isActive, to: true },
          restored: Boolean(existing.deletedAt),
          passwordChanged: !passwordMatches,
        },
      },
    }),
  ]);
  console.log(`Updated ${email} from ADMIN_EMAIL: active Principal Adjuster with the ADMIN_PASSWORD. Remove ADMIN_PASSWORD now.`);
}

async function main() {
  await loadDemoData();
  await ensureAdmin();
  if ((await prisma.user.count()) === 0) {
    console.warn("No users yet: set LOAD_DEMO_DATA=true, or ADMIN_EMAIL and ADMIN_PASSWORD, so someone can sign in.");
  }
}

main()
  // Logged loudly but never fatal: a bad setting here must not keep the whole site from starting.
  .catch((err) => console.error(`FIRST-START STEP FAILED: ${err instanceof Error ? err.message : String(err)}`))
  .finally(() => prisma.$disconnect());
