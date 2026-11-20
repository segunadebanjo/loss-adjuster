import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { claimScope } from "../src/lib/scope.js";
import type { AuthUser } from "../src/middleware/authenticate.js";
import { makeClaim, makeOrg, makePolicy, makeUser } from "./helpers.js";

const asAuth = (u: { id: number; role: AuthUser["role"]; organisationId: number | null }): AuthUser => ({
  id: u.id,
  role: u.role,
  organisationId: u.organisationId,
  fullName: "",
  email: "",
});

describe("claim scope", () => {
  it("limits adjusters to their claims and insurers/brokers to their organisation's", async () => {
    const insurerA = await makeOrg("INSURER");
    const insurerB = await makeOrg("INSURER");
    const broker = await makeOrg("BROKER");
    const adj1 = await makeUser("ADJUSTER");
    const adj2 = await makeUser("ADJUSTER");
    const pA = await makePolicy(insurerA.id, broker.id);
    const pB = await makePolicy(insurerB.id);
    const c1 = await makeClaim(pA.id, adj1.id);
    const c2 = await makeClaim(pB.id, adj2.id);
    const c3 = await makeClaim(pB.id, null);
    const mine = [c1.id, c2.id, c3.id];

    const ids = async (user: AuthUser) =>
      (await prisma.claim.findMany({ where: { AND: [claimScope(user), { id: { in: mine } }] }, select: { id: true } }))
        .map((c) => c.id)
        .sort();

    const admin = await makeUser("ADMIN");
    expect(await ids(asAuth(admin))).toEqual(mine.slice().sort());
    expect(await ids(asAuth(adj1))).toEqual([c1.id]);
    expect(await ids(asAuth(adj2))).toEqual([c2.id]);
    const insA = await makeUser("INSURER", { organisationId: insurerA.id });
    expect(await ids(asAuth(insA))).toEqual([c1.id]);
    const insB = await makeUser("INSURER", { organisationId: insurerB.id });
    expect(await ids(asAuth(insB))).toEqual([c2.id, c3.id].sort());
    const brk = await makeUser("INSURER", { organisationId: broker.id });
    expect(await ids(asAuth(brk))).toEqual([c1.id]);
    const orphan = await makeUser("INSURER");
    expect(await ids(asAuth(orphan))).toEqual([]);
  });

  it("hides soft-deleted rows from ordinary reads", async () => {
    const org = await makeOrg();
    const p = await makePolicy(org.id);
    const c = await makeClaim(p.id);
    await prisma.claim.update({ where: { id: c.id }, data: { deletedAt: new Date() } });
    expect(await prisma.claim.findUnique({ where: { id: c.id } })).toBeNull();
    expect(await prisma.claim.count({ where: { id: c.id } })).toBe(0);
    expect(await prisma.claim.findFirst({ where: { id: c.id, deletedAt: { not: null } } })).not.toBeNull();
  });
});
