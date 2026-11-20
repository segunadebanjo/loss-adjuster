import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";

export const PASSWORD = "Correct-Horse-9";
const hash = bcrypt.hashSync(PASSWORD, 4);
let n = 0;

export async function makeOrg(type: "INSURER" | "BROKER" = "INSURER") {
  n += 1;
  return prisma.organisation.create({ data: { name: `Test ${type} ${n} ${Date.now()}`, type } });
}

export async function makeUser(role: Role, extra: { organisationId?: number; isActive?: boolean } = {}) {
  n += 1;
  return prisma.user.create({
    data: { fullName: `Test ${role} ${n}`, email: `user${n}.${Date.now()}@test.example`, role, passwordHash: hash, ...extra },
  });
}

export async function makePolicy(insurerOrgId: number, brokerOrgId: number | null = null) {
  n += 1;
  return prisma.policy.create({
    data: {
      policyNumber: `POL-${n}-${Date.now()}`,
      naicomUid: `UID-${n}-${Date.now()}`,
      insurerOrgId,
      brokerOrgId,
      insurerName: "Insurer",
      insuredName: "Insured",
      policyType: "MOTOR",
      sumInsured: "1000000.00",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
    },
  });
}

export async function makeClaim(policyId: number, assignedAdjusterId: number | null = null) {
  n += 1;
  return prisma.claim.create({
    data: {
      claimReference: `T-${n}-${Date.now()}`,
      policyId,
      assignedAdjusterId,
      dateOfLoss: new Date("2026-10-01"),
      dateInstructed: new Date("2026-10-02"),
      lossState: "Lagos",
      lossAddress: "Somewhere",
      incidentDescription: "Test",
    },
  });
}
