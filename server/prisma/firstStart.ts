/**
 * Runs before the server on every production start (npm run start:prod), and does something only while the
 * database has no users, so nobody is locked out of a fresh deployment:
 *   - LOAD_DEMO_DATA=true          loads the fictional demo data (every password is SEED_PASSWORD), or
 *   - ADMIN_EMAIL + ADMIN_PASSWORD creates the first Principal Adjuster.
 * Once any user exists it does nothing, so it can never wipe or change real data.
 */
import { spawnSync } from "node:child_process";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.count();
  if (users > 0) return;

  if (process.env.LOAD_DEMO_DATA === "true") {
    console.log("Empty database: loading the demo data (LOAD_DEMO_DATA=true).");
    await prisma.$disconnect();
    const run = spawnSync("npx", ["tsx", "prisma/seed.ts"], {
      stdio: "inherit",
      env: { ...process.env, SEED_IN_PRODUCTION: "empty-database" },
    });
    if (run.status !== 0) throw new Error("Loading the demo data failed.");
    return;
  }

  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email || !password) {
    console.warn("No users yet and neither LOAD_DEMO_DATA=true nor ADMIN_EMAIL/ADMIN_PASSWORD is set: nobody can sign in.");
    return;
  }
  if (password.length < 10) throw new Error("ADMIN_PASSWORD must be at least 10 characters.");
  await prisma.user.create({
    data: {
      fullName: process.env.ADMIN_NAME?.trim() || "Principal Adjuster",
      email,
      passwordHash: await bcrypt.hash(password, Number(process.env.BCRYPT_COST ?? 12)),
      role: "ADMIN",
      isActive: true,
    },
  });
  console.log(`Created the first Principal Adjuster: ${email}. Remove ADMIN_PASSWORD from the settings now.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
