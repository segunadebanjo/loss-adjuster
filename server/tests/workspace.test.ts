import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { cloudinaryDriver } from "../src/storage/cloudinary.js";
import { makeOrg, makeUser, signIn } from "./helpers.js";

const app = createApp();
type Session = Awaited<ReturnType<typeof signIn>>;
let admin: Session, adjuster: Session, otherAdjuster: Session, insurer: Session;
let adjusterId: number, otherAdjusterId: number, insurerOrgId: number;
let n = 0;

// Smallest valid PNG (1x1) and a minimal PDF.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

async function newClaim(extra: Record<string, unknown> = {}) {
  n += 1;
  const res = await admin.post("/api/v1/claims", {
    policy: {
      policyNumber: `WS/${Date.now()}/${n}`,
      naicomUid: `WS-${Date.now()}-${n}`,
      insurerOrgId,
      insuredName: "Oregun Foods Ltd",
      policyType: "PROPERTY_FIRE",
      sumInsured: "1000000",
      excessAmount: "50000",
      excessPercentage: "10",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    },
    dateOfLoss: "2026-10-01",
    dateInstructed: "2026-10-02",
    lossState: "Lagos",
    lossAddress: "Oregun",
    incidentDescription: "Fire.",
    assignedAdjusterId: adjusterId,
    ...extra,
  });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.data as { id: number; claimReference: string };
}

beforeAll(async () => {
  const ins = await makeOrg("INSURER");
  insurerOrgId = ins.id;
  const a = await makeUser("ADMIN");
  const j = await makeUser("ADJUSTER");
  const j2 = await makeUser("ADJUSTER");
  adjusterId = j.id;
  otherAdjusterId = j2.id;
  const i = await makeUser("INSURER", { organisationId: ins.id });
  admin = await signIn(app, a.email);
  adjuster = await signIn(app, j.email);
  otherAdjuster = await signIn(app, j2.email);
  insurer = await signIn(app, i.email);
});

describe("inspections", () => {
  it("scheduling moves a new instruction on, and recording the visit starts the investigation", async () => {
    const c = await newClaim();
    const sched = await adjuster.post(`/api/v1/claims/${c.id}/inspections`, { scheduledDate: "2026-10-03T09:00:00+01:00" });
    expect(sched.status).toBe(201);
    const ins = sched.body.data[0];
    expect(ins.adjuster.id).toBe(adjusterId);
    expect((await admin.get(`/api/v1/claims/${c.id}`)).body.data.status).toBe("INSPECTION_SCHEDULED");

    const done = await adjuster.patch(`/api/v1/claims/${c.id}/inspections/${ins.id}`, {
      completedDate: "2026-10-03T11:30:00+01:00",
      gpsLatitude: 6.5965,
      gpsLongitude: 3.3515,
      siteNotes: "Store roof collapsed; electrical panel burnt.",
      causeOfLossVerified: true,
      policyLiabilityConfirmed: true,
    });
    expect(done.status).toBe(200);
    expect(done.body.data[0]).toMatchObject({ gpsLatitude: 6.5965, gpsLongitude: 3.3515, gpsOutsideNigeria: false, causeOfLossVerified: true });
    const claim = (await admin.get(`/api/v1/claims/${c.id}`)).body.data;
    expect(claim.status).toBe("UNDER_INVESTIGATION");
    expect(claim.sla.find((s: { key: string }) => s.key === "INSPECTION").state).toBe("MET");
    expect(await prisma.auditLog.count({ where: { claimId: c.id, action: "INSPECTION_COMPLETED" } })).toBe(1);
    // A completed visit can't be removed.
    expect((await admin.del(`/api/v1/claims/${c.id}/inspections/${ins.id}`, { reason: "x" })).status).toBe(422);
  });

  it("validates coordinates and dates, and flags a point outside Nigeria", async () => {
    const c = await newClaim();
    const ins = (await adjuster.post(`/api/v1/claims/${c.id}/inspections`, { scheduledDate: "2026-10-03T09:00:00Z" })).body.data[0];
    expect((await adjuster.patch(`/api/v1/claims/${c.id}/inspections/${ins.id}`, { gpsLatitude: 95, gpsLongitude: 3 })).status).toBe(400);
    expect((await adjuster.patch(`/api/v1/claims/${c.id}/inspections/${ins.id}`, { gpsLatitude: 6.5 })).status).toBe(400);
    expect((await adjuster.patch(`/api/v1/claims/${c.id}/inspections/${ins.id}`, { completedDate: "2099-01-01T00:00:00Z" })).status).toBe(400);
    const london = await adjuster.patch(`/api/v1/claims/${c.id}/inspections/${ins.id}`, { gpsLatitude: 51.5, gpsLongitude: -0.12 });
    expect(london.body.data[0].gpsOutsideNigeria).toBe(true);
    expect((await admin.del(`/api/v1/claims/${c.id}/inspections/${ins.id}`, {})).status).toBe(400);
    expect((await admin.del(`/api/v1/claims/${c.id}/inspections/${ins.id}`, { reason: "Insured rescheduled." })).status).toBe(200);
  });

  it("keeps other adjusters and insurers out, and only the principal sends another adjuster", async () => {
    const c = await newClaim();
    expect((await otherAdjuster.post(`/api/v1/claims/${c.id}/inspections`, { scheduledDate: "2026-10-03T09:00:00Z" })).status).toBe(404);
    expect((await insurer.get(`/api/v1/claims/${c.id}/inspections`)).status).toBe(403);
    expect((await adjuster.post(`/api/v1/claims/${c.id}/inspections`, { scheduledDate: "2026-10-03T09:00:00Z", adjusterId: otherAdjusterId })).status).toBe(403);
    const r = await admin.post(`/api/v1/claims/${c.id}/inspections`, { scheduledDate: "2026-10-03T09:00:00Z", adjusterId: otherAdjusterId });
    expect(r.body.data[0].adjuster.id).toBe(otherAdjusterId);
  });
});

describe("evidence", () => {
  it("uploads checked files, shares only what is marked for the insurer, and serves signed links", async () => {
    const c = await newClaim();
    const up = await adjuster
      .post(`/api/v1/claims/${c.id}/evidence`)
      .field("category", "Site Damage Photo")
      .field("caption", "Store, north wall")
      .field("visibleToInsurer", "true")
      .attach("files", PNG, "north-wall.png")
      .attach("files", PDF, "estimate.pdf");
    expect(up.status).toBe(201);
    const [png, pdf] = [up.body.data.find((f: { fileName: string }) => f.fileName.endsWith(".png")), up.body.data.find((f: { fileName: string }) => f.fileName.endsWith(".pdf"))];
    expect(png).toMatchObject({ fileType: "PHOTO", mimeType: "image/png", category: "Site Damage Photo", caption: "Store, north wall", visibleToInsurer: true });
    expect(pdf.fileType).toBe("DOCUMENT");
    expect(png.sha256).toMatch(/^[0-9a-f]{64}$/);

    // The signed link serves the exact bytes; a tampered one is refused.
    const file = await request(app).get(png.url);
    expect(file.status).toBe(200);
    expect(Buffer.compare(file.body as Buffer, PNG)).toBe(0);
    expect((await request(app).get(png.url.replace(/sig=[^&]+/, "sig=bad"))).status).toBe(403);
    expect((await request(app).get(png.url.replace(/exp=\d+/, "exp=1"))).status).toBe(403);

    await adjuster.patch(`/api/v1/claims/${c.id}/evidence/${pdf.id}`, { visibleToInsurer: false, caption: "Contractor's estimate" });
    const forInsurer = (await insurer.get(`/api/v1/claims/${c.id}/evidence`)).body.data;
    expect(forInsurer.map((f: { id: number }) => f.id)).toEqual([png.id]);
    expect((await insurer.post(`/api/v1/claims/${c.id}/evidence`).field("category", "Other").attach("files", PNG, "x.png")).status).toBe(403);
    expect((await otherAdjuster.get(`/api/v1/claims/${c.id}/evidence`)).status).toBe(404);
  });

  it("refuses a file whose bytes don't match an accepted type, and refuses the whole batch", async () => {
    const c = await newClaim();
    const res = await adjuster
      .post(`/api/v1/claims/${c.id}/evidence`)
      .field("category", "Police Report")
      .attach("files", PNG, "ok.png")
      .attach("files", Buffer.from("<html><script>alert(1)</script></html>"), "report.jpg");
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/report\.jpg/);
    expect(await prisma.evidenceFile.count({ where: { claimId: c.id } })).toBe(0);
    expect((await adjuster.post(`/api/v1/claims/${c.id}/evidence`).field("category", "Nonsense").attach("files", PNG, "a.png")).status).toBe(400);
    expect((await adjuster.post(`/api/v1/claims/${c.id}/evidence`).field("category", "Other")).status).toBe(400);
  });

  it("removes a file from the claim with a reason, keeping the stored object and the audit", async () => {
    const c = await newClaim();
    const f = (await adjuster.post(`/api/v1/claims/${c.id}/evidence`).field("category", "Other").attach("files", PNG, "dup.png")).body.data[0];
    expect((await adjuster.del(`/api/v1/claims/${c.id}/evidence/${f.id}`, {})).status).toBe(400);
    expect((await adjuster.del(`/api/v1/claims/${c.id}/evidence/${f.id}`, { reason: "Uploaded twice" })).status).toBe(204);
    expect((await adjuster.get(`/api/v1/claims/${c.id}/evidence`)).body.data).toEqual([]);
    expect((await request(app).get(f.url)).status).toBe(200);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { claimId: c.id, action: "EVIDENCE_REMOVED" } });
    expect(audit.details).toMatchObject({ reason: "Uploaded twice", sha256: f.sha256 });
  });

  it("makes signed, authenticated Cloudinary links without a network call", async () => {
    const d = cloudinaryDriver({ cloudName: "demo", apiKey: "123", apiSecret: "abc", folder: "la" });
    const urls = await d.urls({ key: "la/LA-2026-0001/xyz", mime: "image/jpeg", kind: "image", fileName: "wall photo.jpg" });
    expect(urls.url).toMatch(/^https:\/\/res\.cloudinary\.com\/demo\/image\/authenticated\/s--[\w-]{8}--\//);
    expect(urls.thumbnailUrl).toMatch(/c_fill.*q_auto/);
    expect(urls.downloadUrl).toMatch(/fl_attachment:wall_photo/);
  });
});

describe("schedule of loss", () => {
  it("computes line nets and the settlement, stores the recommendation and audits each change", async () => {
    const c = await newClaim();
    const base = `/api/v1/claims/${c.id}/valuation`;
    expect((await adjuster.get(base)).body.settlement.netRecommended).toBe("0.00");
    expect((await admin.get(`/api/v1/claims/${c.id}`)).body.data.recommendedSettlement).toBeNull();

    await adjuster.post(`${base}/items`, { itemDescription: "Stock", category: "Stock & Contents", claimedAmount: "900,000", assessedAmount: "800000" });
    await adjuster.post(`${base}/items`, { itemDescription: "Roof", category: "Building/Civil Works", claimedAmount: "300000", assessedAmount: "250000", depreciationAmount: "40000", bettermentDeduction: "10000" });
    const v = (await adjuster.post(`${base}/items`, { itemDescription: "Scrap sold", category: "Salvage Recovery", assessedAmount: "50000" })).body;
    expect(v.items.map((i: { netPayable: string }) => i.netPayable)).toEqual(["800000.00", "200000.00", "50000.00"]);
    // 800k + 200k - 50k = 950k, capped at the 1m sum insured after excess: 10% of 950k = 95k > 50k fixed.
    expect(v.settlement).toMatchObject({ grossLoss: "950000.00", excess: { applied: "95000.00", basis: "PERCENTAGE" }, netRecommended: "855000.00" });

    // Underinsured: value at risk 1.25m -> 80%.
    await adjuster.patch(`/api/v1/claims/${c.id}`, { valueAtRisk: "1250000" });
    const after = (await adjuster.get(base)).body;
    expect(after.settlement.average).toMatchObject({ applied: true, ratioPercent: "80.00" });
    expect(after.settlement.netRecommended).toBe("684000.00"); // 760k - 76k
    expect((await admin.get(`/api/v1/claims/${c.id}`)).body.data.recommendedSettlement).toBe("684000.00");

    // A policy edit (smaller excess %) flows through.
    const claim = (await admin.get(`/api/v1/claims/${c.id}`)).body.data;
    await admin.patch(`/api/v1/policies/${claim.policy.id}`, { excessPercentage: "5" });
    expect((await admin.get(`/api/v1/claims/${c.id}`)).body.data.recommendedSettlement).toBe("710000.00"); // 760k - 50k fixed

    expect(await prisma.auditLog.count({ where: { claimId: c.id, action: "VALUATION_ITEM_ADDED" } })).toBe(3);
  });

  it("validates lines, edits and deletes them, and reorders", async () => {
    const c = await newClaim();
    const base = `/api/v1/claims/${c.id}/valuation`;
    expect((await adjuster.post(`${base}/items`, { itemDescription: "X", category: "Labor", assessedAmount: "100", depreciationAmount: "80", bettermentDeduction: "30" })).status).toBe(400);
    expect((await adjuster.post(`${base}/items`, { itemDescription: "S", category: "Salvage Recovery", assessedAmount: "100", depreciationAmount: "1" })).status).toBe(400);
    expect((await adjuster.post(`${base}/items`, { itemDescription: "", category: "Labor" })).status).toBe(400);
    const a = (await adjuster.post(`${base}/items`, { itemDescription: "A", category: "Labor", assessedAmount: "100" })).body.items[0];
    const b = (await adjuster.post(`${base}/items`, { itemDescription: "B", category: "Labor", assessedAmount: "200" })).body.items[1];
    const edited = await adjuster.patch(`${base}/items/${a.id}`, { depreciationAmount: "30" });
    expect(edited.body.items[0].netPayable).toBe("70.00");
    expect((await adjuster.patch(`${base}/items/${a.id}`, { depreciationAmount: "500" })).status).toBe(400);
    const order = await adjuster.put(`${base}/order`, { ids: [b.id, a.id] });
    expect(order.body.items.map((i: { id: number }) => i.id)).toEqual([b.id, a.id]);
    expect((await adjuster.put(`${base}/order`, { ids: [b.id] })).status).toBe(400);
    const del = await adjuster.del(`${base}/items/${b.id}`);
    expect(del.body.items).toHaveLength(1);
    expect((await insurer.get(base)).status).toBe(403);
    expect((await otherAdjuster.get(base)).status).toBe(404);
  });

  it("freezes the schedule while it is with the principal for sign-off", async () => {
    const c = await newClaim();
    const base = `/api/v1/claims/${c.id}/valuation`;
    await adjuster.post(`${base}/items`, { itemDescription: "A", category: "Labor", assessedAmount: "100" });
    await prisma.claim.update({ where: { id: c.id }, data: { status: "PENDING_SIGNOFF" } });
    expect((await adjuster.get(base)).body.editable).toBe(false);
    expect((await adjuster.post(`${base}/items`, { itemDescription: "B", category: "Labor", assessedAmount: "1" })).status).toBe(422);
    expect((await adjuster.patch(`/api/v1/claims/${c.id}`, { valueAtRisk: "5" })).status).toBe(422);
  });
});
