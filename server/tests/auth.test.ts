import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { makeOrg, makeUser, PASSWORD } from "./helpers.js";

const app = createApp();

function refreshCookie(res: request.Response): string {
  const cookies = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  const c = cookies.find((x) => x.startsWith("la_refresh="));
  if (!c) throw new Error("no refresh cookie");
  return c.split(";")[0]!;
}

describe("auth", () => {
  let admin: Awaited<ReturnType<typeof makeUser>>;
  beforeAll(async () => {
    admin = await makeUser("ADMIN");
  });

  it("signs in, returns the user and sets an httpOnly refresh cookie", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({ email: admin.email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf("string");
    expect(res.body.user).toMatchObject({ id: admin.id, role: "ADMIN" });
    expect(res.body.user.passwordHash).toBeUndefined();
    const raw = ([] as string[]).concat(res.headers["set-cookie"] ?? []).join(";");
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/Path=\/api\/v1\/auth/);

    const me = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(admin.email);
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const a = await request(app).post("/api/v1/auth/login").send({ email: admin.email, password: "nope" });
    const b = await request(app).post("/api/v1/auth/login").send({ email: "nobody@test.example", password: "nope" });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it("validates the body", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("refuses an inactive user, and a token stops working once the user is deactivated", async () => {
    const inactive = await makeUser("ADJUSTER", { isActive: false });
    const res = await request(app).post("/api/v1/auth/login").send({ email: inactive.email, password: PASSWORD });
    expect(res.status).toBe(401);

    const u = await makeUser("ADJUSTER");
    const login = await request(app).post("/api/v1/auth/login").send({ email: u.email, password: PASSWORD });
    await prisma.user.update({ where: { id: u.id }, data: { isActive: false } });
    const me = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${login.body.accessToken}`);
    expect(me.status).toBe(401);
  });

  it("rejects a missing or forged access token", async () => {
    expect((await request(app).get("/api/v1/auth/me")).status).toBe(401);
    const forged = await request(app).get("/api/v1/auth/me").set("Authorization", "Bearer abc.def.ghi");
    expect(forged.status).toBe(401);
  });

  it("rotates the refresh token, and reuse of an old one signs every session out", async () => {
    const u = await makeUser("ADJUSTER");
    const login = await request(app).post("/api/v1/auth/login").send({ email: u.email, password: PASSWORD });
    const first = refreshCookie(login);

    const r1 = await request(app).post("/api/v1/auth/refresh").set("Cookie", first);
    expect(r1.status).toBe(200);
    const second = refreshCookie(r1);
    expect(second).not.toBe(first);

    // Pretend the first token was rotated long ago, then replay it: theft is assumed.
    await prisma.refreshToken.updateMany({
      where: { userId: u.id, revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });
    const replay = await request(app).post("/api/v1/auth/refresh").set("Cookie", first);
    expect(replay.status).toBe(401);
    const afterReuse = await request(app).post("/api/v1/auth/refresh").set("Cookie", second);
    expect(afterReuse.status).toBe(401);
    const audit = await prisma.auditLog.findFirst({ where: { userId: u.id, action: "REFRESH_TOKEN_REUSE" } });
    expect(audit).not.toBeNull();
  });

  it("logout revokes the refresh token", async () => {
    const u = await makeUser("ADJUSTER");
    const login = await request(app).post("/api/v1/auth/login").send({ email: u.email, password: PASSWORD });
    const cookie = refreshCookie(login);
    const out = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", cookie)
      .set("Authorization", `Bearer ${login.body.accessToken}`);
    expect(out.status).toBe(204);
    expect((await request(app).post("/api/v1/auth/refresh").set("Cookie", cookie)).status).toBe(401);
  });

  it("returns the insurer's organisation", async () => {
    const org = await makeOrg("INSURER");
    const u = await makeUser("INSURER", { organisationId: org.id });
    const res = await request(app).post("/api/v1/auth/login").send({ email: u.email, password: PASSWORD });
    expect(res.body.user.organisation).toMatchObject({ id: org.id, type: "INSURER" });
  });

  it("rate-limits repeated failed sign-ins", async () => {
    const u = await makeUser("ADJUSTER");
    for (let i = 0; i < 5; i++) {
      await request(app).post("/api/v1/auth/login").send({ email: u.email, password: "wrong" });
    }
    const blocked = await request(app).post("/api/v1/auth/login").send({ email: u.email, password: PASSWORD });
    expect(blocked.status).toBe(429);
  });
});
