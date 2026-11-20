import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { makeClaim, makeOrg, makePolicy, makeUser, signIn } from "./helpers.js";

const app = createApp();
let admin: Awaited<ReturnType<typeof signIn>>;
let adminId: number;

beforeAll(async () => {
  const a = await makeUser("ADMIN");
  adminId = a.id;
  admin = await signIn(app, a.email);
});

describe("users admin", () => {
  it("creates adjusters and insurer users, requiring an organisation only for insurers", async () => {
    const adj = await admin.post("/api/v1/users", {
      fullName: "Bola Tinubu-Okoro",
      email: `Bola.${Date.now()}@Test.Example`,
      role: "ADJUSTER",
      password: "a-long-password",
      ciiQualification: "ACII",
      naicomLicenseNo: "LA/2026/0001",
    });
    expect(adj.status).toBe(201);
    expect(adj.body.data.email).toBe(adj.body.data.email.toLowerCase());
    expect(adj.body.data.passwordHash).toBeUndefined();
    // The new user can sign in.
    const login = await request(app).post("/api/v1/auth/login").send({ email: adj.body.data.email, password: "a-long-password" });
    expect(login.status).toBe(200);

    const noOrg = await admin.post("/api/v1/users", { fullName: "X", email: `x${Date.now()}@t.example`, role: "INSURER", password: "a-long-password" });
    expect(noOrg.status).toBe(400);
    const org = await makeOrg("INSURER");
    const withOrg = await admin.post("/api/v1/users", { fullName: "Y", email: `y${Date.now()}@t.example`, role: "INSURER", organisationId: org.id, password: "a-long-password" });
    expect(withOrg.status).toBe(201);
    expect(withOrg.body.data.organisation.id).toBe(org.id);
    const staffWithOrg = await admin.post("/api/v1/users", { fullName: "Z", email: `z${Date.now()}@t.example`, role: "ADJUSTER", organisationId: org.id, password: "a-long-password" });
    expect(staffWithOrg.status).toBe(400);
    const short = await admin.post("/api/v1/users", { fullName: "S", email: `s${Date.now()}@t.example`, role: "ADJUSTER", password: "short" });
    expect(short.status).toBe(400);
    const dup = await admin.post("/api/v1/users", { fullName: "D", email: adj.body.data.email, role: "ADJUSTER", password: "a-long-password" });
    expect(dup.status).toBe(409);
  });

  it("won't deactivate an adjuster with open claims, and deactivation signs the user out", async () => {
    const adj = await makeUser("ADJUSTER");
    const org = await makeOrg("INSURER");
    const claim = await makeClaim((await makePolicy(org.id)).id, adj.id);
    const blocked = await admin.patch(`/api/v1/users/${adj.id}`, { isActive: false });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.details.openClaims).toBe(1);

    await prisma.claim.update({ where: { id: claim.id }, data: { assignedAdjusterId: null } });
    const session = await signIn(app, adj.email);
    expect((await admin.patch(`/api/v1/users/${adj.id}`, { isActive: false })).status).toBe(200);
    expect((await session.get("/api/v1/auth/me")).status).toBe(401);
    expect(await prisma.refreshToken.count({ where: { userId: adj.id, revokedAt: null } })).toBe(0);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: adj.id, action: "USER_UPDATED" } });
    expect(audit.details).toMatchObject({ changes: { isActive: { from: true, to: false } } });
  });

  it("stops an admin locking themselves out", async () => {
    expect((await admin.patch(`/api/v1/users/${adminId}`, { isActive: false })).status).toBe(422);
    expect((await admin.patch(`/api/v1/users/${adminId}`, { role: "ADJUSTER" })).status).toBe(422);
    expect((await admin.patch(`/api/v1/users/${adminId}`, { phone: "+2348000000000" })).status).toBe(200);
  });

  it("sets a password and ends the user's sessions", async () => {
    const u = await makeUser("ADJUSTER");
    await signIn(app, u.email);
    expect((await admin.put(`/api/v1/users/${u.id}/password`, { password: "brand-new-password" })).status).toBe(204);
    expect(await prisma.refreshToken.count({ where: { userId: u.id, revokedAt: null } })).toBe(0);
    expect((await request(app).post("/api/v1/auth/login").send({ email: u.email, password: "brand-new-password" })).status).toBe(200);
  });

  it("is admin only", async () => {
    const adj = await makeUser("ADJUSTER");
    const s = await signIn(app, adj.email);
    expect((await s.get("/api/v1/users")).status).toBe(403);
    expect((await s.get("/api/v1/organisations")).status).toBe(403);
    expect((await s.get("/api/v1/policies")).status).toBe(403);
  });

  it("renaming an organisation updates the name printed on its policies", async () => {
    const org = await makeOrg("INSURER");
    const p = await makePolicy(org.id);
    const res = await admin.patch(`/api/v1/organisations/${org.id}`, { name: `Renamed Assurance ${Date.now()}` });
    expect(res.status).toBe(200);
    expect((await prisma.policy.findUniqueOrThrow({ where: { id: p.id } })).insurerName).toBe(res.body.data.name);
  });
});

describe("every API route needs a session", () => {
  const routes: Array<[string, string]> = [
    ["get", "/api/v1/claims"],
    ["get", "/api/v1/claims/1"],
    ["get", "/api/v1/claims/meta/options"],
    ["post", "/api/v1/claims"],
    ["patch", "/api/v1/claims/1"],
    ["post", "/api/v1/claims/1/assign"],
    ["post", "/api/v1/claims/1/transition"],
    ["delete", "/api/v1/claims/1"],
    ["get", "/api/v1/dashboard/kpis"],
    ["get", "/api/v1/policies"],
    ["get", "/api/v1/policies/verify"],
    ["post", "/api/v1/policies"],
    ["get", "/api/v1/organisations"],
    ["get", "/api/v1/users"],
    ["put", "/api/v1/users/1/password"],
  ];
  it.each(routes)("%s %s -> 401", async (method, url) => {
    const res = await (request(app) as unknown as Record<string, (u: string) => request.Test>)[method]!(url);
    expect(res.status).toBe(401);
  });
});
