import { beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { makeOrg, makeUser, signIn } from "./helpers.js";

const app = createApp();
type Session = Awaited<ReturnType<typeof signIn>>;
let principal: Session, secondPrincipal: Session, adjuster: Session, insurer: Session, otherInsurer: Session;
let adjusterId: number, insurerOrgId: number;
let n = 0;

const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};
const pdf = (s: Session, url: string) => s.get(url).buffer(true).parse(binary);

const SECTIONS_PRELIM = {
  background: "Instructed by the insurer.",
  circumstances: "Fire in the store.",
  inspection: "Visited on 3 October.",
  cause: "Electrical fault.",
  liability: "Within cover.",
  reserve: "NGN 900,000.",
};
const SECTIONS_FINAL = {
  background: "Instructed.",
  circumstances: "Fire.",
  investigation: "Inspected and interviewed staff.",
  cause: "Electrical fault.",
  liability: "Covered; underinsured.",
  quantum: "See the schedule.",
  recommendation: "Settle on the figure below.",
};

/** A claim taken to "under investigation" through the real actions. */
async function investigatedClaim() {
  n += 1;
  const c = (await principal.post("/api/v1/claims", {
    policy: { policyNumber: `RP/${Date.now()}/${n}`, naicomUid: `RP-${Date.now()}-${n}`, insurerOrgId, insuredName: "Apapa Mills Ltd", policyType: "PROPERTY_FIRE", sumInsured: "1000000", excessAmount: "10000", startDate: "2026-01-01", endDate: "2026-12-31" },
    dateOfLoss: "2026-10-01", dateInstructed: "2026-10-02", lossState: "Lagos", lossAddress: "Apapa", incidentDescription: "Fire in the store.", assignedAdjusterId: adjusterId,
  })).body.data;
  const ins = (await adjuster.post(`/api/v1/claims/${c.id}/inspections`, { scheduledDate: "2026-10-03T09:00:00Z" })).body.data[0];
  await adjuster.patch(`/api/v1/claims/${c.id}/inspections/${ins.id}`, { completedDate: "2026-10-03T11:00:00Z", siteNotes: "Store gutted.", causeOfLossVerified: true });
  return c as { id: number; claimReference: string };
}

beforeAll(async () => {
  const org = await makeOrg("INSURER");
  insurerOrgId = org.id;
  const p1 = await makeUser("ADMIN");
  const p2 = await makeUser("ADMIN");
  const j = await makeUser("ADJUSTER");
  adjusterId = j.id;
  principal = await signIn(app, p1.email);
  secondPrincipal = await signIn(app, p2.email);
  adjuster = await signIn(app, j.email);
  insurer = await signIn(app, (await makeUser("INSURER", { organisationId: org.id })).email);
  otherInsurer = await signIn(app, (await makeUser("INSURER", { organisationId: (await makeOrg("INSURER")).id })).email);
});

describe("preliminary report", () => {
  it("drafts with prefilled text, refuses an incomplete submit, and approval sends it and moves the claim", async () => {
    const c = await investigatedClaim();
    const base = `/api/v1/claims/${c.id}/reports`;
    const draft = (await adjuster.post(base, { type: "PRELIMINARY" })).body.data;
    expect(draft).toMatchObject({ type: "PRELIMINARY", version: 1, status: "DRAFT" });
    expect(draft.body.sections.circumstances).toBe("Fire in the store.");
    expect(draft.body.sections.inspection).toBe("Store gutted.");
    expect((await adjuster.post(base, { type: "PRELIMINARY" })).status).toBe(409);
    expect((await insurer.get(base)).body.data).toEqual([]);

    const incomplete = await adjuster.post(`${base}/${draft.id}/submit`);
    expect(incomplete.status).toBe(422);
    expect(incomplete.body.error.details.map((d: { path: string }) => d.path)).toEqual(["cause", "liability", "reserve"]);
    expect((await adjuster.patch(`${base}/${draft.id}`, { sections: { nonsense: "x" } })).status).toBe(422);
    await adjuster.patch(`${base}/${draft.id}`, { sections: SECTIONS_PRELIM });
    expect((await adjuster.post(`${base}/${draft.id}/submit`)).body.data.status).toBe("SUBMITTED");
    // Frozen once submitted.
    expect((await adjuster.patch(`${base}/${draft.id}`, { sections: { cause: "changed" } })).status).toBe(422);

    // The preview is a DRAFT PDF; insurers can't fetch it.
    const preview = await pdf(principal, `${base}/${draft.id}/pdf`);
    expect(preview.status).toBe(200);
    expect(preview.headers["content-type"]).toBe("application/pdf");
    expect((preview.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
    expect((await insurer.get(`${base}/${draft.id}/pdf`)).status).toBe(404);

    expect((await adjuster.post(`${base}/${draft.id}/approve`)).status).toBe(403);
    const ok = await principal.post(`${base}/${draft.id}/approve`);
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ status: "APPROVED", pdfSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect((await principal.get(`/api/v1/claims/${c.id}`)).body.data.status).toBe("PRELIM_REPORT_SUBMITTED");

    // The insurer downloads exactly the signed-off file; other insurers can't.
    const listed = (await insurer.get(base)).body.data;
    expect(listed).toHaveLength(1);
    expect(listed[0].body).toBeUndefined();
    const file = await pdf(insurer, `${base}/${draft.id}/pdf`);
    expect(createHash("sha256").update(file.body as Buffer).digest("hex")).toBe(ok.body.data.pdfSha256);
    expect((await otherInsurer.get(`${base}/${draft.id}/pdf`)).status).toBe(404);
    // Only one preliminary report.
    expect((await adjuster.post(base, { type: "PRELIMINARY" })).status).toBe(409);
  });
});

describe("final report and sign-off", () => {
  it("submits to sign-off, can be returned, and only an approved report allows settlement", async () => {
    const c = await investigatedClaim();
    const base = `/api/v1/claims/${c.id}/reports`;
    const pre = (await adjuster.post(base, { type: "PRELIMINARY" })).body.data;
    await adjuster.patch(`${base}/${pre.id}`, { sections: SECTIONS_PRELIM });
    await adjuster.post(`${base}/${pre.id}/submit`);
    await principal.post(`${base}/${pre.id}/approve`);

    const fin = (await adjuster.post(base, { type: "FINAL" })).body.data;
    expect(fin.body.sections.cause).toBe("Electrical fault."); // carried from the preliminary report
    await adjuster.patch(`${base}/${fin.id}`, { sections: SECTIONS_FINAL });
    const noSchedule = await adjuster.post(`${base}/${fin.id}/submit`);
    expect(noSchedule.status).toBe(422);
    expect(noSchedule.body.error.message).toMatch(/schedule of loss/);

    await adjuster.post(`/api/v1/claims/${c.id}/valuation/items`, { itemDescription: "Stock", category: "Stock & Contents", claimedAmount: "800000", assessedAmount: "600000" });
    const sub = await adjuster.post(`${base}/${fin.id}/submit`);
    expect(sub.body.data.status).toBe("SUBMITTED");
    const claim = (await principal.get(`/api/v1/claims/${c.id}`)).body.data;
    expect(claim.status).toBe("PENDING_SIGNOFF");
    expect(claim.timeline.slice(-2).map((h: { toStatus: string }) => h.toStatus)).toEqual(["FINAL_REPORT_DRAFTED", "PENDING_SIGNOFF"]);
    // Settlement waits for sign-off, and the figures are locked.
    expect((await principal.post(`/api/v1/claims/${c.id}/transition`, { to: "SETTLED", settledAmount: "590000" })).status).toBe(422);
    expect((await adjuster.post(`/api/v1/claims/${c.id}/valuation/items`, { itemDescription: "x", category: "Labor", assessedAmount: "1" })).status).toBe(422);

    // Returned: back to drafting, report editable.
    expect((await principal.post(`${base}/${fin.id}/return`, {})).status).toBe(400);
    const ret = await principal.post(`${base}/${fin.id}/return`, { reason: "Show the salvage." });
    expect(ret.body.data).toMatchObject({ status: "RETURNED", returnReason: "Show the salvage." });
    expect((await principal.get(`/api/v1/claims/${c.id}`)).body.data.status).toBe("FINAL_REPORT_DRAFTED");
    await adjuster.post(`/api/v1/claims/${c.id}/valuation/items`, { itemDescription: "Salvage", category: "Salvage Recovery", assessedAmount: "50000" });
    await adjuster.patch(`${base}/${fin.id}`, { sections: { quantum: "See the schedule, with salvage." } });
    await adjuster.post(`${base}/${fin.id}/submit`);

    // The approved PDF is built from what was submitted; a claim edit after submission doesn't change it.
    const report = await prisma.report.findUniqueOrThrow({ where: { id: fin.id } });
    expect((report.figures as { valuation: { settlement: { netRecommended: string } } }).valuation.settlement.netRecommended).toBe("540000.00");

    const ok = await principal.post(`${base}/${fin.id}/approve`);
    expect(ok.body.data.status).toBe("APPROVED");
    const detail = (await principal.get(`/api/v1/claims/${c.id}`)).body.data;
    expect(detail.status).toBe("PENDING_SIGNOFF");
    expect(detail.sla.find((s: { key: string }) => s.key === "SIGNOFF").state).toBe("MET");
    const settled = await principal.post(`/api/v1/claims/${c.id}/transition`, { to: "SETTLED", settledAmount: "540000" });
    expect(settled.body.data.status).toBe("SETTLED");
    // Insurers see the settled figure now.
    expect((await insurer.get(`/api/v1/claims/${c.id}`)).body.data.recommendedSettlement).toBe("540000.00");
  });

  it("needs a second principal to sign off a principal's own report, and records a sole principal's reason", async () => {
    const c = await investigatedClaim();
    const base = `/api/v1/claims/${c.id}/reports`;
    const r = (await principal.post(base, { type: "PRELIMINARY" })).body.data;
    await principal.patch(`${base}/${r.id}`, { sections: SECTIONS_PRELIM });
    await principal.post(`${base}/${r.id}/submit`);
    const self = await principal.post(`${base}/${r.id}/approve`);
    expect(self.status).toBe(403);
    expect(self.body.error.message).toMatch(/another principal/);
    expect((await secondPrincipal.post(`${base}/${r.id}/approve`)).body.data.status).toBe("APPROVED");

    // With every other principal deactivated, self-approval needs a note.
    const c2 = await investigatedClaim();
    const base2 = `/api/v1/claims/${c2.id}/reports`;
    const r2 = (await principal.post(base2, { type: "PRELIMINARY" })).body.data;
    await principal.patch(`${base2}/${r2.id}`, { sections: SECTIONS_PRELIM });
    await principal.post(`${base2}/${r2.id}/submit`);
    const me = (await principal.get("/api/v1/auth/me")).body.user;
    const others = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true, id: { not: me.id } } });
    await prisma.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { isActive: false } });
    try {
      expect((await principal.post(`${base2}/${r2.id}/approve`, {})).status).toBe(422);
      const ok = await principal.post(`${base2}/${r2.id}/approve`, { note: "Sole principal while the second principal is on leave." });
      expect(ok.body.data).toMatchObject({ status: "APPROVED", selfApprovalNote: "Sole principal while the second principal is on leave." });
    } finally {
      await prisma.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { isActive: true } });
    }
  });

  it("refuses to send a signed-off PDF that has been altered", async () => {
    const c = await investigatedClaim();
    const base = `/api/v1/claims/${c.id}/reports`;
    const r = (await adjuster.post(base, { type: "PRELIMINARY" })).body.data;
    await adjuster.patch(`${base}/${r.id}`, { sections: SECTIONS_PRELIM });
    await adjuster.post(`${base}/${r.id}/submit`);
    await principal.post(`${base}/${r.id}/approve`);
    const stored = await prisma.report.findUniqueOrThrow({ where: { id: r.id } });
    const tampered = Buffer.from(stored.pdfData!);
    tampered[tampered.length - 10] = tampered[tampered.length - 10]! ^ 1;
    await prisma.report.update({ where: { id: r.id }, data: { pdfData: new Uint8Array(tampered) } });
    const res = await insurer.get(`${base}/${r.id}/pdf`);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("PDF_ALTERED");
  });
});

describe("fee notes", () => {
  it("drafts with VAT and WHT, issues with a sequential number and frozen PDF, and tracks payment", async () => {
    const c = await investigatedClaim();
    const base = `/api/v1/claims/${c.id}/fee-notes`;
    const body = { professionalFee: "1,000,000", expenses: [{ description: "Travel to Apapa", amount: "150000" }, { description: "Photographs", amount: "50000" }] };
    expect((await adjuster.post(base, body)).status).toBe(403);
    expect((await insurer.post(base, body)).status).toBe(403);
    const draft = (await principal.post(base, body)).body.data;
    expect(draft).toMatchObject({ status: "DRAFT", feeNoteNo: null, grossAmount: "1200000.00", vatAmount: "90000.00", invoiceTotal: "1290000.00", whtAmount: "100000.00", netPayable: "1190000.00", vatRate: "7.50", whtRate: "10.00" });
    expect((await insurer.get(base)).body.data).toEqual([]);
    expect((await adjuster.get(base)).body.data).toHaveLength(1);
    const edited = (await principal.patch(`${base}/${draft.id}`, { professionalFee: "800000" })).body.data;
    expect(edited.netPayable).toBe("995000.00"); // 800k fee + 200k expenses + 75k VAT - 80k WHT; expenses kept

    const issued = (await principal.post(`${base}/${draft.id}/issue`)).body.data;
    expect(issued.feeNoteNo).toMatch(/^FN-\d{4}-\d{4}$/);
    expect((await principal.get(`/api/v1/claims/${c.id}`)).body.data.adjusterFee).toBe("800000.00");
    expect((await principal.patch(`${base}/${draft.id}`, { professionalFee: "1" })).status).toBe(422);
    const second = (await principal.post(base, { professionalFee: "50000" })).body.data;
    const issued2 = (await principal.post(`${base}/${second.id}/issue`)).body.data;
    expect(Number(issued2.feeNoteNo.slice(-4))).toBe(Number(issued.feeNoteNo.slice(-4)) + 1);
    expect((await principal.get(`/api/v1/claims/${c.id}`)).body.data.adjusterFee).toBe("850000.00");

    const file = await pdf(insurer, `${base}/${draft.id}/pdf`);
    expect(file.status).toBe(200);
    expect(createHash("sha256").update(file.body as Buffer).digest("hex")).toBe(issued.pdfSha256);
    expect((await insurer.get(base)).body.data).toHaveLength(2);

    expect((await principal.post(`${base}/${draft.id}/paid`, { paidOn: "2099-01-01" })).status).toBe(422);
    const paid = (await principal.post(`${base}/${draft.id}/paid`, { paidOn: new Date(Date.now() + 3600_000).toISOString().slice(0, 10), reference: "NIP/2026/0001" })).body.data;
    expect(paid).toMatchObject({ status: "PAID", paymentReference: "NIP/2026/0001" });
    expect((await principal.post(`${base}/${draft.id}/cancel`, { reason: "x" })).status).toBe(422);

    const cancelled = (await principal.post(`${base}/${second.id}/cancel`, { reason: "Raised in error." })).body.data;
    expect(cancelled.status).toBe("CANCELLED");
    expect((await principal.get(`/api/v1/claims/${c.id}`)).body.data.adjusterFee).toBe("800000.00");
    expect((await insurer.get(base)).body.data).toHaveLength(1);
  });
});

describe("audit trail", () => {
  it("lists the claim's and its policy's entries for staff only", async () => {
    const c = await investigatedClaim();
    const res = await principal.get(`/api/v1/claims/${c.id}/audit`);
    const actions = res.body.data.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["CLAIM_INSTRUCTED", "POLICY_CREATED", "INSPECTION_SCHEDULED", "INSPECTION_COMPLETED", "CLAIM_STATUS_CHANGED"]));
    expect(res.body.data[0].user).toHaveProperty("fullName");
    expect((await adjuster.get(`/api/v1/claims/${c.id}/audit`)).status).toBe(200);
    expect((await insurer.get(`/api/v1/claims/${c.id}/audit`)).status).toBe(403);
  });
});
