import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { todayLagos } from "../src/lib/dates.js";
import { makeOrg, makeUser, signIn } from "./helpers.js";

const app = createApp();
type Session = Awaited<ReturnType<typeof signIn>>;

let admin: Session, adjuster: Session, otherAdjuster: Session, insurer: Session, otherInsurer: Session, broker: Session;
let adjusterId: number, otherAdjusterId: number, insurerOrgId: number, brokerOrgId: number;
let uidSeq = 0;

function newPolicy(extra: Record<string, unknown> = {}) {
  uidSeq += 1;
  return {
    policyNumber: `TP/FIR/${Date.now()}/${uidSeq}`,
    naicomUid: `nuid-test-${Date.now()}-${uidSeq}`,
    insurerOrgId,
    brokerOrgId,
    insuredName: "Ikeja Test Industries Ltd",
    policyType: "PROPERTY_FIRE",
    sumInsured: "100,000,000.00",
    excessAmount: "250000",
    excessPercentage: "10",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    ...extra,
  };
}

function intakeBody(extra: Record<string, unknown> = {}) {
  return {
    policy: newPolicy(),
    dateOfLoss: "2026-10-01",
    dateInstructed: "2026-10-03",
    lossState: "Lagos",
    lossLga: "Ikeja",
    lossAddress: "Plot 1, Oregun",
    incidentDescription: "Fire in the store.",
    initialReserve: "12,500,000",
    assignedAdjusterId: adjusterId,
    ...extra,
  };
}

beforeAll(async () => {
  const ins = await makeOrg("INSURER");
  const ins2 = await makeOrg("INSURER");
  const brk = await makeOrg("BROKER");
  insurerOrgId = ins.id;
  brokerOrgId = brk.id;
  const a = await makeUser("ADMIN");
  const j = await makeUser("ADJUSTER");
  const j2 = await makeUser("ADJUSTER");
  adjusterId = j.id;
  otherAdjusterId = j2.id;
  const i = await makeUser("INSURER", { organisationId: ins.id });
  const i2 = await makeUser("INSURER", { organisationId: ins2.id });
  const b = await makeUser("INSURER", { organisationId: brk.id });
  admin = await signIn(app, a.email);
  adjuster = await signIn(app, j.email);
  otherAdjuster = await signIn(app, j2.email);
  insurer = await signIn(app, i.email);
  otherInsurer = await signIn(app, i2.email);
  broker = await signIn(app, b.email);
});

describe("instruction intake", () => {
  it("creates the policy and claim with a sequential LA-YYYY-NNNN reference and first status", async () => {
    const r1 = await admin.post("/api/v1/claims", intakeBody());
    const r2 = await admin.post("/api/v1/claims", intakeBody());
    expect(r1.status).toBe(201);
    const c1 = r1.body.data;
    expect(c1.claimReference).toMatch(/^LA-2026-\d{4}$/);
    const n1 = Number(c1.claimReference.slice(-4));
    expect(Number(r2.body.data.claimReference.slice(-4))).toBe(n1 + 1);
    expect(c1).toMatchObject({ status: "NEW_INSTRUCTION", initialReserve: "12500000.00", applyAverage: true });
    expect(c1.policy).toMatchObject({ sumInsured: "100000000.00", excessAmount: "250000.00", excessPercentage: "10.00" });
    expect(c1.policy.naicomUid).toBe(c1.policy.naicomUid.toUpperCase());
    expect(c1.timeline).toHaveLength(1);
    const audit = await prisma.auditLog.findFirst({ where: { claimId: c1.id, action: "CLAIM_INSTRUCTED" } });
    expect(audit).not.toBeNull();
  });

  it("rolls back the new policy when the claim can't be created", async () => {
    const body = intakeBody({ assignedAdjusterId: 999999 });
    const res = await admin.post("/api/v1/claims", body);
    expect(res.status).toBe(400);
    expect(await prisma.policy.findUnique({ where: { naicomUid: String(body.policy.naicomUid).toUpperCase() } })).toBeNull();
  });

  it("validates dates, money and the state", async () => {
    const bad = await admin.post("/api/v1/claims", intakeBody({ initialReserve: "-5", lossState: "Atlantis" }));
    expect(bad.status).toBe(400);
    const paths = bad.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["initialReserve", "lossState"]));
    const order = await admin.post("/api/v1/claims", intakeBody({ dateOfLoss: "2026-10-05", dateInstructed: "2026-10-03" }));
    expect(order.status).toBe(400);
    expect(order.body.error.details[0].path).toBe("dateOfLoss");
    const future = await admin.post("/api/v1/claims", intakeBody({ dateInstructed: "2099-01-01" }));
    expect(future.status).toBe(400);
    const both = await admin.post("/api/v1/claims", intakeBody({ policyId: 1 }));
    expect(both.status).toBe(400);
  });

  it("finds a policy by NAICOM UID and warns about a likely duplicate instruction", async () => {
    const first = (await admin.post("/api/v1/claims", intakeBody())).body.data;
    const verify = await admin.get(`/api/v1/policies/verify?naicomUid=${first.policy.naicomUid.toLowerCase()}`);
    expect(verify.body.found).toBe(true);
    expect(verify.body.claims[0].claimReference).toBe(first.claimReference);
    expect((await admin.get("/api/v1/policies/verify?naicomUid=NOPE-123")).body.found).toBe(false);

    const again = { ...intakeBody(), policy: undefined, policyId: first.policy.id };
    const dup = await admin.post("/api/v1/claims", again);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("DUPLICATE_SUSPECTED");
    const forced = await admin.post("/api/v1/claims", { ...again, confirmDuplicate: true });
    expect(forced.status).toBe(201);
  });

  it("is for the principal adjuster only", async () => {
    expect((await adjuster.post("/api/v1/claims", intakeBody())).status).toBe(403);
    expect((await insurer.post("/api/v1/claims", intakeBody())).status).toBe(403);
    expect((await adjuster.get("/api/v1/policies/verify?naicomUid=X")).status).toBe(403);
  });
});

describe("visibility", () => {
  it("scopes detail and list to the caller and hides unsettled figures from insurers", async () => {
    const c = (await admin.post("/api/v1/claims", intakeBody())).body.data;
    await prisma.claim.update({ where: { id: c.id }, data: { recommendedSettlement: "5000000.00", adjusterFee: "400000.00" } });

    expect((await adjuster.get(`/api/v1/claims/${c.id}`)).status).toBe(200);
    expect((await otherAdjuster.get(`/api/v1/claims/${c.id}`)).status).toBe(404);
    expect((await otherInsurer.get(`/api/v1/claims/${c.id}`)).status).toBe(404);
    expect((await broker.get(`/api/v1/claims/${c.id}`)).status).toBe(200);

    const asInsurer = (await insurer.get(`/api/v1/claims/${c.id}`)).body.data;
    expect(asInsurer.recommendedSettlement).toBeNull();
    expect(asInsurer.adjusterFee).toBeUndefined();
    expect(asInsurer.valueAtRisk).toBeUndefined();
    expect(asInsurer.allowedTransitions).toEqual([]);
    expect(asInsurer.timeline[0].changedBy).toBeUndefined();
    expect((await adjuster.get(`/api/v1/claims/${c.id}`)).body.data.recommendedSettlement).toBe("5000000.00");

    const list = await otherInsurer.get(`/api/v1/claims?q=${c.claimReference}`);
    expect(list.body.meta.total).toBe(0);
    expect((await insurer.get(`/api/v1/claims?q=${c.claimReference}`)).body.data[0].recommendedSettlement).toBeNull();
  });

  it("filters the list by status, adjuster, line, insurer, dates and text", async () => {
    const c = (await admin.post("/api/v1/claims", intakeBody({ dateInstructed: "2026-09-15", dateOfLoss: "2026-09-14" }))).body.data;
    const q = (s: string) => admin.get(`/api/v1/claims?insurerId=${insurerOrgId}&${s}`).then((r) => r.body.data.map((x: { id: number }) => x.id));
    expect(await q("from=2026-09-15&to=2026-09-15")).toEqual([c.id]);
    expect(await q("line=PROPERTY&from=2026-09-15&to=2026-09-15")).toEqual([c.id]);
    expect(await q("line=MOTOR,MARINE&from=2026-09-15&to=2026-09-15")).toEqual([]);
    expect(await q(`status=NEW_INSTRUCTION&adjusterId=${adjusterId}&from=2026-09-15&to=2026-09-15`)).toEqual([c.id]);
    expect(await q("state=closed&from=2026-09-15&to=2026-09-15")).toEqual([]);
    expect(await q(`q=${c.policy.policyNumber}`)).toEqual([c.id]);
    const page = await admin.get(`/api/v1/claims?insurerId=${insurerOrgId}&pageSize=2&page=1&sort=claimReference`);
    expect(page.body.data).toHaveLength(2);
    expect(page.body.data[0].claimReference < page.body.data[1].claimReference).toBe(true);
    expect((await admin.get("/api/v1/claims?sort=passwordHash")).status).toBe(400);
  });
});

describe("workflow", () => {
  it("makes the manual moves with history and audit, and leaves report-driven moves to the reports", async () => {
    const c = (await admin.post("/api/v1/claims", intakeBody())).body.data;
    const move = (s: Session, to: string, extra: object = {}) => s.post(`/api/v1/claims/${c.id}/transition`, { to, ...extra });

    expect((await move(adjuster, "INSPECTION_SCHEDULED")).status).toBe(200);
    expect((await move(adjuster, "UNDER_INVESTIGATION")).status).toBe(200);
    // Sending the preliminary report is done by approving it, not by the button.
    const viaReport = await move(admin, "PRELIM_REPORT_SUBMITTED");
    expect(viaReport.status).toBe(409);
    expect(viaReport.body.error.message).toMatch(/Reports tab/);
    const detail = (await admin.get(`/api/v1/claims/${c.id}`)).body.data;
    expect(detail.allowedTransitions.map((t: { to: string }) => t.to)).toEqual(["REPUDIATED"]);

    const rep = await move(admin, "REPUDIATED", { reason: "Material non-disclosure." });
    expect(rep.body.data).toMatchObject({ status: "REPUDIATED", repudiationReason: "Material non-disclosure." });
    expect(rep.body.data.closedAt).not.toBeNull();
    // Closed: no edits until reopened.
    expect((await admin.patch(`/api/v1/claims/${c.id}`, { lossLga: "Agege" })).status).toBe(422);
    const reopened = await move(admin, "UNDER_INVESTIGATION", { reason: "Insured produced the disclosure letter." });
    expect(reopened.body.data).toMatchObject({ status: "UNDER_INVESTIGATION", repudiationReason: null, closedAt: null });
    expect(reopened.body.data.timeline.map((h: { toStatus: string }) => h.toStatus)).toEqual([
      "NEW_INSTRUCTION", "INSPECTION_SCHEDULED", "UNDER_INVESTIGATION", "REPUDIATED", "UNDER_INVESTIGATION",
    ]);
    expect(await prisma.auditLog.count({ where: { claimId: c.id, action: "CLAIM_STATUS_CHANGED" } })).toBe(4);
  });

  it("refuses moves not in the workflow, moves by other adjusters, and moves without an adjuster", async () => {
    const c = (await admin.post("/api/v1/claims", intakeBody())).body.data;
    const skip = await admin.post(`/api/v1/claims/${c.id}/transition`, { to: "SETTLED", settledAmount: "1" });
    expect(skip.status).toBe(409);
    expect((await otherAdjuster.post(`/api/v1/claims/${c.id}/transition`, { to: "INSPECTION_SCHEDULED" })).status).toBe(404);
    expect((await insurer.post(`/api/v1/claims/${c.id}/transition`, { to: "INSPECTION_SCHEDULED" })).status).toBe(403);

    const unassigned = (await admin.post("/api/v1/claims", intakeBody({ assignedAdjusterId: null }))).body.data;
    expect((await admin.post(`/api/v1/claims/${unassigned.id}/transition`, { to: "INSPECTION_SCHEDULED" })).status).toBe(422);
    // Repudiation needs a reason but no adjuster.
    expect((await admin.post(`/api/v1/claims/${unassigned.id}/transition`, { to: "REPUDIATED" })).status).toBe(400);
    const rep = await admin.post(`/api/v1/claims/${unassigned.id}/transition`, { to: "REPUDIATED", reason: "Loss before inception." });
    expect(rep.body.data).toMatchObject({ status: "REPUDIATED", repudiationReason: "Loss before inception." });
  });

  it("assigns and reassigns adjusters (principal only) and audits it", async () => {
    const c = (await admin.post("/api/v1/claims", intakeBody({ assignedAdjusterId: null }))).body.data;
    expect((await adjuster.post(`/api/v1/claims/${c.id}/assign`, { adjusterId })).status).toBe(403);
    const r = await admin.post(`/api/v1/claims/${c.id}/assign`, { adjusterId: otherAdjusterId });
    expect(r.body.data.assignedAdjuster.id).toBe(otherAdjusterId);
    expect((await otherAdjuster.get(`/api/v1/claims/${c.id}`)).status).toBe(200);
    const insurerUser = await prisma.user.findFirstOrThrow({ where: { role: "INSURER" } });
    expect((await admin.post(`/api/v1/claims/${c.id}/assign`, { adjusterId: insurerUser.id })).status).toBe(400);
    expect(await prisma.auditLog.count({ where: { claimId: c.id, action: "CLAIM_ASSIGNED" } })).toBe(1);
  });

  it("lets the assigned adjuster edit site details but not the reserve, and records the diff", async () => {
    const c = (await admin.post("/api/v1/claims", intakeBody())).body.data;
    expect((await adjuster.patch(`/api/v1/claims/${c.id}`, { initialReserve: "1" })).status).toBe(403);
    const ok = await adjuster.patch(`/api/v1/claims/${c.id}`, { lossAddress: "Plot 9, Oregun", valueAtRisk: "150000000" });
    expect(ok.status).toBe(200);
    expect(ok.body.data.valueAtRisk).toBe("150000000.00");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { claimId: c.id, action: "CLAIM_UPDATED" } });
    expect(audit.details).toMatchObject({ changes: { lossAddress: { from: "Plot 1, Oregun", to: "Plot 9, Oregun" } } });
    expect((await admin.patch(`/api/v1/claims/${c.id}`, { dateOfLoss: "2026-10-09" })).status).toBe(400);
  });

  it("soft-deletes only a new instruction, with a reason", async () => {
    const c = (await admin.post("/api/v1/claims", intakeBody())).body.data;
    expect((await admin.del(`/api/v1/claims/${c.id}`, {})).status).toBe(400);
    expect((await admin.del(`/api/v1/claims/${c.id}`, { reason: "Logged twice." })).status).toBe(204);
    expect((await admin.get(`/api/v1/claims/${c.id}`)).status).toBe(404);
    expect(await prisma.claim.findFirst({ where: { id: c.id, deletedAt: { not: null } } })).not.toBeNull();

    const busy = (await admin.post("/api/v1/claims", intakeBody())).body.data;
    await adjuster.post(`/api/v1/claims/${busy.id}/transition`, { to: "INSPECTION_SCHEDULED" });
    expect((await admin.del(`/api/v1/claims/${busy.id}`, { reason: "x" })).status).toBe(422);
  });
});

describe("dashboard", () => {
  it("computes KPIs for the caller's scope", async () => {
    const org = await makeOrg("INSURER");
    const scoped = async (extra: Record<string, unknown> = {}) =>
      (await admin.post("/api/v1/claims", intakeBody({ policy: newPolicy({ insurerOrgId: org.id, brokerOrgId: null }), ...extra }))).body.data;
    const a = await scoped({ initialReserve: "1000000" });
    await scoped({ initialReserve: "2000000", assignedAdjusterId: null });
    const s = await scoped({ initialReserve: "500000" });
    // Schedule of loss for the settled one: claimed 10m (+ a salvage line that doesn't count as claimed).
    await prisma.valuationItem.createMany({
      data: [
        { claimId: s.id, itemDescription: "Stock", category: "Stock & Contents", claimedAmount: "10000000.00", assessedAmount: "8000000.00" },
        { claimId: s.id, itemDescription: "Salvage", category: "Salvage Recovery", claimedAmount: "999.00", assessedAmount: "500000.00" },
      ],
    });
    await prisma.claim.update({ where: { id: s.id }, data: { status: "SETTLED", settledAmount: "7500000.00", closedAt: new Date() } });

    const k = (await admin.get(`/api/v1/dashboard/kpis?insurerId=${org.id}`)).body;
    expect(k.activeInstructions).toBe(2);
    expect(k.unassigned).toBe(1);
    expect(k.pendingInspections).toMatchObject({ total: 2, unscheduled: 2 });
    expect(k.openReserve).toBe("3000000.00");
    expect(k.claimedVsAdjusted).toMatchObject({ claimsCompared: 1, totalClaimed: "10000000.00", totalAdjusted: "7500000.00", savings: "2500000.00", savingsPercent: 25 });
    expect(k.byStatus.find((x: { status: string }) => x.status === "SETTLED").count).toBe(1);
    expect(k.byLine.find((x: { line: string }) => x.line === "PROPERTY")).toMatchObject({ count: 3, open: 2, openReserve: "3000000.00" });
    // Every milestone is listed (defaults come from a migration) and each of the 3 claims is counted once.
    expect(k.sla.map((x: { key: string }) => x.key)).toEqual(["INSPECTION", "PRELIM_REPORT", "FINAL_REPORT", "SIGNOFF"]);
    for (const row of k.sla) expect(Object.values(row.counts as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(3);
    expect(a.id).toBeGreaterThan(0);

    // The adjuster sees only their own claims.
    const kj = (await adjuster.get(`/api/v1/dashboard/kpis?insurerId=${org.id}`)).body;
    expect(kj.activeInstructions).toBe(1);
    expect(kj.workload).toEqual([]);
  });
});

describe("options", () => {
  it("gives staff the adjusters and insurers, and insurers neither", async () => {
    const staff = (await admin.get("/api/v1/claims/meta/options")).body;
    expect(staff.adjusters.some((a: { id: number }) => a.id === adjusterId)).toBe(true);
    expect(staff.states).toContain("FCT");
    const ins = (await insurer.get("/api/v1/claims/meta/options")).body;
    expect(ins.adjusters).toEqual([]);
    expect(ins.insurers).toEqual([]);
  });

  it("uses Lagos time for today", () => {
    expect(todayLagos(new Date("2026-11-20T23:30:00Z"))).toBe("2026-11-21");
  });
});
