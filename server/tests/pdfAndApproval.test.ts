import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { apportion, sharesComplete } from "../src/lib/apportion.js";
import { matrixProblem, tierFor } from "../src/lib/approvalMatrix.js";
import { formatNaira } from "../src/pdf/handlebars.js";
import { closePdfBrowser, renderHtml, renderReportPdf, TEMPLATE_FILES } from "../src/pdf/pdfGenerator.js";
import { createHandlebars } from "../src/pdf/handlebars.js";
import { feeNoteView, reportView } from "../src/pdf/views.js";
import { computeFeeNote } from "../src/lib/feeNote.js";
import { firm } from "../src/lib/firm.js";
import { makeOrg, makeUser, signIn } from "./helpers.js";

const app = createApp();
type Session = Awaited<ReturnType<typeof signIn>>;
let p1: Session, p2: Session, p3: Session, adjuster: Session, insurer: Session;
let adjusterId: number, insurerOrgId: number, follower1: number, follower2: number;
let n = 0;

const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};
const pdf = (s: Session, url: string) => s.get(url).buffer(true).parse(binary);

const PRELIM = { background: "Instructed.", circumstances: "Explosion at the jetty.\n\nMore detail.", inspection: "Visited.", cause: "Gas leak.", liability: "Within cover.\n\nSubject to documents.", reserve: "NGN 90m." };
const FINAL = { background: "Instructed.", circumstances: "Explosion at the jetty.", investigation: "Inspected.", cause: "Gas leak.", liability: "Covered.", quantum: "See schedule.", recommendation: "Settle." };

describe("pure helpers", () => {
  it("apportions to the kobo with the residue on the lead", () => {
    const parts = apportion("100.00", [
      { name: "Lead", role: "LEAD", sharePercent: "33.33" },
      { name: "B", role: "FOLLOWER", sharePercent: "33.33" },
      { name: "C", role: "FOLLOWER", sharePercent: "33.34" },
    ]);
    expect(parts.map((p) => p.amount)).toEqual(["33.33", "33.33", "33.34"]);
    const odd = apportion("0.10", [{ name: "L", role: "LEAD", sharePercent: "50" }, { name: "F", role: "FOLLOWER", sharePercent: "50" }]);
    expect(odd.map((p) => p.amount)).toEqual(["0.05", "0.05"]);
    expect(sharesComplete(["60", "25", "15"])).toBe(true);
    expect(sharesComplete(["60", "25", "14.99"])).toBe(false);
  });

  it("picks the tier by amount and checks a matrix", () => {
    const tiers = [{ label: "Standard", minAmount: "0.00", requiredApprovals: 1 }, { label: "Large", minAmount: "50000000.00", requiredApprovals: 2 }];
    expect(tierFor(tiers, "49999999.99").label).toBe("Standard");
    expect(tierFor(tiers, "50000000.00").label).toBe("Large");
    expect(tierFor([], "1").requiredApprovals).toBe(1);
    expect(matrixProblem(tiers)).toBeNull();
    expect(matrixProblem([{ label: "x", minAmount: "10.00", requiredApprovals: 1 }])).toMatch(/NGN 0.00/);
    expect(matrixProblem([...tiers, { label: "y", minAmount: "90000000.00", requiredApprovals: 1 }])).toMatch(/fewer/);
  });

  it("formats naira with en-NG separators and two decimals, without floats", () => {
    expect(formatNaira("1250000")).toBe("1,250,000.00");
    expect(formatNaira("98765432109876.5")).toBe("98,765,432,109,876.50");
    expect(formatNaira(null)).toBe("0.00");
  });
});

beforeAll(async () => {
  insurerOrgId = (await makeOrg("INSURER")).id;
  follower1 = (await makeOrg("INSURER")).id;
  follower2 = (await makeOrg("INSURER")).id;
  const j = await makeUser("ADJUSTER");
  adjusterId = j.id;
  p1 = await signIn(app, (await makeUser("ADMIN")).email);
  p2 = await signIn(app, (await makeUser("ADMIN")).email);
  p3 = await signIn(app, (await makeUser("ADMIN")).email);
  adjuster = await signIn(app, j.email);
  insurer = await signIn(app, (await makeUser("INSURER", { organisationId: insurerOrgId })).email);
});

afterAll(async () => {
  await closePdfBrowser();
});

/** A co-insured claim taken to a submitted final report recommending about NGN 79.99m. */
async function largeLossAtSignOff() {
  n += 1;
  const c = (await p1.post("/api/v1/claims", {
    policy: {
      policyNumber: `AM/${Date.now()}/${n}`, naicomUid: `AM-${Date.now()}-${n}`, insurerOrgId, insuredName: "Bonny Coastal Ltd", policyType: "OIL_AND_GAS",
      sumInsured: "100000000", excessAmount: "10000", startDate: "2026-01-01", endDate: "2026-12-31",
      leadSharePercent: "60", coInsurers: [{ organisationId: follower1, sharePercent: "25" }, { organisationId: follower2, sharePercent: "15" }],
    },
    dateOfLoss: "2026-10-01", dateInstructed: "2026-10-02", lossState: "Rivers", lossAddress: "Bonny", incidentDescription: "Explosion.", assignedAdjusterId: adjusterId,
  })).body.data;
  const ins = (await adjuster.post(`/api/v1/claims/${c.id}/inspections`, { scheduledDate: "2026-10-03T09:00:00Z" })).body.data[0];
  await adjuster.patch(`/api/v1/claims/${c.id}/inspections/${ins.id}`, { completedDate: "2026-10-03T11:00:00Z", siteNotes: "Jetty damaged." });
  const base = `/api/v1/claims/${c.id}/reports`;
  const pre = (await adjuster.post(base, { type: "PRELIMINARY" })).body.data;
  await adjuster.patch(`${base}/${pre.id}`, { sections: PRELIM });
  await adjuster.post(`${base}/${pre.id}/submit`);
  expect((await p1.post(`${base}/${pre.id}/approve`)).body.data.status).toBe("APPROVED");
  const fin = (await adjuster.post(base, { type: "FINAL" })).body.data;
  await adjuster.patch(`${base}/${fin.id}`, { sections: FINAL });
  await adjuster.post(`/api/v1/claims/${c.id}/valuation/items`, { itemDescription: "Jetty", category: "Building/Civil Works", claimedAmount: "90000000", assessedAmount: "80000000" });
  const sub = (await adjuster.post(`${base}/${fin.id}/submit`)).body.data;
  return { claimId: c.id as number, base, finalId: fin.id as number, sub };
}

describe("co-insured policies", () => {
  it("needs the shares to add up to 100% and lists the co-insurers on the claim", async () => {
    const bad = await p1.post("/api/v1/policies", {
      policyNumber: `CO/${Date.now()}`, naicomUid: `CO-${Date.now()}`, insurerOrgId, insuredName: "X", policyType: "MOTOR", sumInsured: "1000", startDate: "2026-01-01", endDate: "2026-12-31",
      leadSharePercent: "60", coInsurers: [{ organisationId: follower1, sharePercent: "30" }],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/100%/);
    const lead = await p1.post("/api/v1/policies", {
      policyNumber: `CO2/${Date.now()}`, naicomUid: `CO2-${Date.now()}`, insurerOrgId, insuredName: "X", policyType: "MOTOR", sumInsured: "1000", startDate: "2026-01-01", endDate: "2026-12-31",
      leadSharePercent: "50", coInsurers: [{ organisationId: insurerOrgId, sharePercent: "50" }],
    });
    expect(lead.status).toBe(400);
    const ok = await p1.post("/api/v1/policies", {
      policyNumber: `CO3/${Date.now()}`, naicomUid: `CO3-${Date.now()}`, insurerOrgId, insuredName: "X", policyType: "MOTOR", sumInsured: "1000", startDate: "2026-01-01", endDate: "2026-12-31",
      leadSharePercent: "70", coInsurers: [{ organisationId: follower1, sharePercent: "30" }],
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ leadSharePercent: "70.00", coInsurers: [{ organisationId: follower1, sharePercent: "30.00" }] });
    // Dropping the co-insurers needs the lead back at 100%.
    expect((await p1.patch(`/api/v1/policies/${ok.body.data.id}`, { coInsurers: [] })).status).toBe(400);
    const solo = await p1.patch(`/api/v1/policies/${ok.body.data.id}`, { coInsurers: [], leadSharePercent: "100" });
    expect(solo.body.data).toMatchObject({ leadSharePercent: "100.00", coInsurers: [] });
  });
});

describe("approval matrix", () => {
  it("is read by staff and changed only by a principal, with checks", async () => {
    const tiers = (await adjuster.get("/api/v1/approval-tiers")).body.data;
    expect(tiers).toEqual([{ label: "Standard", minAmount: "0.00", requiredApprovals: 1 }, { label: "Large loss", minAmount: "50000000.00", requiredApprovals: 2 }]);
    expect((await insurer.get("/api/v1/approval-tiers")).status).toBe(403);
    expect((await adjuster.put("/api/v1/approval-tiers", { tiers })).status).toBe(403);
    expect((await p1.put("/api/v1/approval-tiers", { tiers: [{ label: "x", minAmount: "5", requiredApprovals: 1 }] })).status).toBe(422);
    const changed = await p1.put("/api/v1/approval-tiers", { tiers: [...tiers, { label: "Catastrophe", minAmount: "500000000", requiredApprovals: 3 }] });
    expect(changed.body.data).toHaveLength(3);
    await p1.put("/api/v1/approval-tiers", { tiers });
  });

  it("needs two different principals above NGN 50m; the PDF stays a preview until the tier is met", async () => {
    const { claimId, base, finalId, sub } = await largeLossAtSignOff();
    expect(sub).toMatchObject({ status: "SUBMITTED", requiredApprovals: 2, approvalTier: "Large loss", approvals: [] });

    // Before sign-off: staff get a DRAFT preview by type; the insurer gets nothing.
    const preview = await pdf(p1, `${base}/final/pdf`);
    expect(preview.status).toBe(200);
    expect(preview.headers["content-disposition"]).toMatch(/DRAFT/);
    expect((await insurer.get(`${base}/final/pdf`)).status).toBe(404);

    const first = await p1.post(`${base}/${finalId}/approve`);
    expect(first.body.data).toMatchObject({ status: "SUBMITTED", signOffComplete: false, approvals: [{ approvedBy: { fullName: expect.any(String) } }] });
    expect((await p1.post(`${base}/${finalId}/approve`)).status).toBe(409);
    expect((await insurer.get(`${base}/final/pdf`)).status).toBe(404);

    // Returning voids the sign-offs given; resubmitting starts again.
    await p2.post(`${base}/${finalId}/return`, { reason: "Check the jetty figure." });
    await adjuster.post(`${base}/${finalId}/submit`);
    expect((await p1.get(base)).body.data.find((r: { id: number }) => r.id === finalId).approvals).toEqual([]);

    expect((await p1.post(`${base}/${finalId}/approve`)).body.data.signOffComplete).toBe(false);
    const second = await p3.post(`${base}/${finalId}/approve`);
    expect(second.body.data).toMatchObject({ status: "APPROVED", signOffComplete: true });
    expect(second.body.data.approvals).toHaveLength(2);

    const file = await pdf(insurer, `${base}/final/pdf`);
    expect(file.status).toBe(200);
    expect(createHash("sha256").update(file.body as Buffer).digest("hex")).toBe(second.body.data.pdfSha256);
    expect((await p1.get(`/api/v1/claims/${claimId}`)).body.data.policy.coInsurers).toHaveLength(2);
  });
});

describe("fee note PDF by claim", () => {
  it("gives staff the draft as a preview and the insurer only an issued note", async () => {
    const { claimId } = await largeLossAtSignOff();
    expect((await p1.get(`/api/v1/claims/${claimId}/fee-note/pdf`)).status).toBe(404);
    const fn = (await p1.post(`/api/v1/claims/${claimId}/fee-notes`, { professionalFee: "2000000", expenses: [{ description: "Travel", amount: "150000" }] })).body.data;
    const draft = await pdf(p1, `/api/v1/claims/${claimId}/fee-note/pdf`);
    expect(draft.status).toBe(200);
    expect(draft.headers["content-disposition"]).toMatch(/DRAFT/);
    expect((await insurer.get(`/api/v1/claims/${claimId}/fee-note/pdf`)).status).toBe(404);
    const issued = (await p1.post(`/api/v1/claims/${claimId}/fee-notes/${fn.id}/issue`)).body.data;
    const file = await pdf(insurer, `/api/v1/claims/${claimId}/fee-note/pdf`);
    expect(file.status).toBe(200);
    expect(createHash("sha256").update(file.body as Buffer).digest("hex")).toBe(issued.pdfSha256);
  });

  it("saves the co-adjusting firm, principal only", async () => {
    const { claimId } = await largeLossAtSignOff();
    expect((await adjuster.patch(`/api/v1/claims/${claimId}`, { coAdjusterFirm: "Delta Adjusters" })).status).toBe(403);
    // At sign-off the claim can still take the co-adjuster's details.
    const res = await p1.patch(`/api/v1/claims/${claimId}`, { coAdjusterFirm: "Delta Adjusters Ltd", coAdjusterNaicomNo: "NAICOM/LA/0099", coAdjusterSplitPercent: "30" });
    expect(res.body.data.coAdjuster).toEqual({ firm: "Delta Adjusters Ltd", naicomNo: "NAICOM/LA/0099", splitPercent: "30.00" });
    expect((await p1.patch(`/api/v1/claims/${claimId}`, { coAdjusterFirm: null })).body.data.coAdjuster).toBeNull();
  });
});

describe("HTML templates through headless Chrome", () => {
  it("fills the template, escapes typed text, watermarks a preview and prints a PDF", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "la-templates-"));
    writeFileSync(
      path.join(dir, TEMPLATE_FILES.report),
      `<!DOCTYPE html><html><head><title>{{reportType}} - {{claimReference}}</title></head><body>
       <h1>{{firm.name}}</h1><p>Sum insured: ₦{{formatCurrency policy.sumInsured}}</p><p>{{narrative.circumstancesAndCause}}</p>
       {{#each coInsurers}}<p>{{this.name}} {{this.sharePercent}}% {{formatCurrency this.shareAmount}}</p>{{/each}}
       <p>NET ₦{{formatCurrency quantum.netAdjustedPayable}}</p></body></html>`,
    );
    const model = {
      firm: firm(), type: "FINAL" as const, version: 1, approved: false, date: new Date("2026-11-20T10:00:00Z"),
      claim: { reference: "LA-2026-0001", insurerClaimNo: null, dateOfLoss: "2026-10-01", dateInstructed: "2026-10-02", location: "Bonny", initialReserve: "0.00" },
      policy: { insuredName: "Bonny Coastal", policyNumber: "P1", naicomUid: "U1", className: "Oil & Gas", period: "1 January 2026 to 31 December 2026", sumInsured: "100000000.00", excess: "None" },
      insurer: { name: "Lead Ins", address: null, sharePercent: "60.00" },
      coInsurers: [{ name: "Lead Ins", role: "LEAD" as const, sharePercent: "60.00" }, { name: "Follow Ins", role: "FOLLOWER" as const, sharePercent: "40.00" }],
      broker: null, adjuster: null, approver: null, inspection: null,
      sections: [{ key: "circumstances", title: "C", text: "<script>alert(1)</script> fire" }],
      valuation: undefined,
    };
    const view = reportView(model);
    expect(view.coInsurers.map((c) => c.shareAmount)).toEqual(["0.00", "0.00"]);
    const render = createHandlebars().compile(`{{narrative.circumstancesAndCause}}`);
    expect(renderHtml(render, view, "DRAFT / PREVIEW")).toContain("&lt;script&gt;");
    expect(renderHtml(render, view, "DRAFT / PREVIEW")).toContain("DRAFT / PREVIEW");

    const before = env.TEMPLATES_DIR;
    env.TEMPLATES_DIR = dir;
    try {
      const out = await renderReportPdf(model);
      expect(out.subarray(0, 5).toString()).toBe("%PDF-");
      // Chrome writes its own producer line; PDFKit's would say PDFKit.
      expect(out.toString("latin1")).not.toMatch(/PDFKit/);
    } finally {
      env.TEMPLATES_DIR = before;
    }
  }, 60_000);

  it("falls back to the built-in layout when a template is broken, so sign-off never fails", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "la-broken-"));
    writeFileSync(path.join(dir, TEMPLATE_FILES.report), "<html><body>{{#if coInsurers.length}}<table>");
    const before = env.TEMPLATES_DIR;
    env.TEMPLATES_DIR = dir;
    try {
      const out = await renderReportPdf({
        firm: firm(), type: "PRELIMINARY", version: 1, approved: false, date: new Date(),
        claim: { reference: "LA-1", insurerClaimNo: null, dateOfLoss: "2026-10-01", dateInstructed: "2026-10-02", location: "Lagos", initialReserve: "0.00" },
        policy: { insuredName: "X", policyNumber: "P", naicomUid: "U", className: "Motor", period: "a to b", sumInsured: "1.00", excess: "None" },
        insurer: { name: "I", address: null }, broker: null, adjuster: null, approver: null, inspection: null, sections: [],
      });
      expect(out.toString("latin1")).toMatch(/PDFKit/);
    } finally {
      env.TEMPLATES_DIR = before;
    }
  });

  it("gives the fee note template its figures, with co-insurer columns that add up", () => {
    const figures = computeFeeNote({ professionalFee: "6500000", expenses: [{ description: "Travel", amount: "1650000" }], vatRate: "7.5", whtRate: "10" });
    const v = feeNoteView({
      firm: firm(), number: "FN-2026-0001", status: "ISSUED", date: new Date("2026-11-20T10:00:00Z"),
      insurer: { name: "Lead", address: null },
      claim: { reference: "LA-1", insurerClaimNo: null, insuredName: "X", policyNumber: "P", dateOfLoss: "2026-10-01", className: "Oil & Gas" },
      expenses: [{ description: "Travel", amount: "1650000" }], figures, notes: null,
      coInsurers: [{ name: "Lead", role: "LEAD", sharePercent: "60" }, { name: "B", role: "FOLLOWER", sharePercent: "25" }, { name: "C", role: "FOLLOWER", sharePercent: "15" }],
      basis: { type: "Net adjusted loss", amount: "412200000.00" },
    });
    expect(v.feeNote).toMatchObject({ vatAmount: "487500.00", grossTotalPayable: "8637500.00", expectedWhtAmount: "650000.00", dueDate: "4 December 2026" });
    expect(v.coInsurers.map((c) => c.totalShareDue)).toEqual(["5182500.00", "2159375.00", "1295625.00"]);
  });
});
