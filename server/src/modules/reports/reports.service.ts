import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma, Report, ReportType } from "@prisma/client";
import { prisma, type Tx } from "../../lib/prisma.js";
import { recordAudit } from "../../lib/audit.js";
import { AppError, conflict, forbidden, notFound, unprocessable } from "../../lib/errors.js";
import { dateOut } from "../../lib/dates.js";
import { firm } from "../../lib/firm.js";
import { fromKobo, moneyOut, toKobo } from "../../lib/money.js";
import { SALVAGE_CATEGORY } from "../../lib/settlement.js";
import { buildReportPdf, type ReportPdfModel } from "../../pdf/reportPdf.js";
import { longDate, money } from "../../pdf/common.js";
import type { AuthUser } from "../../middleware/authenticate.js";
import { POLICY_TYPE_LABELS, claimForStaffWrite, findScopedClaim, moveClaimStatus } from "../claims/claims.service.js";
import { recomputeSettlement } from "../valuation/settlementStore.js";

export interface SectionDef {
  key: string;
  title: string;
  required: boolean;
  hint: string;
}

/** The sections of each report, in print order. */
export const REPORT_SECTIONS: Record<ReportType, SectionDef[]> = {
  PRELIMINARY: [
    { key: "background", title: "Instruction", required: true, hint: "Who instructed us, when, and what we were asked to do." },
    { key: "circumstances", title: "Circumstances of the loss", required: true, hint: "What happened, as reported and as we found it." },
    { key: "inspection", title: "Our inspection", required: true, hint: "The site visit: what we saw, who we met. The inspection checklist is added below it." },
    { key: "cause", title: "Cause of loss", required: true, hint: "The proximate cause, and how it was verified." },
    { key: "liability", title: "Policy liability", required: true, hint: "Whether the loss falls within the cover, warranties and conditions, any concerns." },
    { key: "reserve", title: "Reserve recommendation", required: true, hint: "Our recommended reserve and its basis." },
    { key: "documents", title: "Documents required", required: false, hint: "What the insured must still provide." },
    { key: "nextSteps", title: "Next steps", required: false, hint: "What we will do next and when." },
  ],
  FINAL: [
    { key: "background", title: "Instruction", required: true, hint: "Who instructed us, when, and our earlier reports." },
    { key: "circumstances", title: "Circumstances of the loss", required: true, hint: "What happened." },
    { key: "investigation", title: "Our investigation", required: true, hint: "Inspections, interviews and documents examined." },
    { key: "cause", title: "Cause of loss", required: true, hint: "The proximate cause and how it was established." },
    { key: "liability", title: "Policy liability", required: true, hint: "Cover, warranties, conditions, underinsurance." },
    { key: "quantum", title: "Measure of indemnity", required: true, hint: "How the figures were reached. The schedule of loss and the adjustment are added below it." },
    { key: "recommendation", title: "Recommendation", required: true, hint: "The settlement we recommend and on what terms (e.g. discharge voucher)." },
    { key: "conclusion", title: "Conclusion", required: false, hint: "Anything else the insurer should know." },
  ],
};

export const createInput = z.object({ type: z.enum(["PRELIMINARY", "FINAL"]) });
export const bodyInput = z.object({ sections: z.record(z.string(), z.string().max(20_000)) });
export const approveInput = z.object({ note: z.string().trim().max(2000).optional() });
export const returnInput = z.object({ reason: z.string().trim().min(1, "Say what needs to change.").max(5000) });

type Body = { sections: Record<string, string> };
const OPEN_REPORT = ["DRAFT", "SUBMITTED", "RETURNED"] as const;

// Where in the workflow each report can be started.
const CAN_START: Record<ReportType, string[]> = {
  PRELIMINARY: ["INSPECTION_SCHEDULED", "UNDER_INVESTIGATION"],
  FINAL: ["UNDER_INVESTIGATION", "PRELIM_REPORT_SUBMITTED", "AWAITING_DOCUMENTS", "FINAL_REPORT_DRAFTED"],
};

const include = {
  draftedBy: { select: { id: true, fullName: true } },
  reviewedBy: { select: { id: true, fullName: true } },
} as const;
type ReportRow = Prisma.ReportGetPayload<{ include: typeof include }>;

function reportOut(r: ReportRow, staff: boolean) {
  return {
    id: r.id,
    type: r.type,
    version: r.version,
    status: r.status,
    draftedBy: r.draftedBy,
    submittedAt: r.submittedAt?.toISOString() ?? null,
    reviewedBy: r.reviewedBy,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    pdfSha256: r.pdfSha256,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    ...(staff ? { body: r.body as Body, returnReason: r.returnReason, selfApprovalNote: r.selfApprovalNote } : {}),
  };
}

const excessText = (amount: string, pct: string) => {
  const fixed = toKobo(amount) > 0n ? money(moneyOut(amount)) : null;
  const p = toKobo(pct) > 0n ? `${Number(pct)}% of the loss` : null;
  return fixed && p ? `${fixed} or ${p}, whichever is greater` : (fixed ?? p ?? "None");
};

/**
 * Everything a report prints, read now from the claim. Frozen into `figures` when the report is submitted, so later
 * edits to the claim never change what was signed off.
 */
async function snapshot(tx: Tx, claimId: number, type: ReportType, body: Body) {
  const claim = await tx.claim.findUniqueOrThrow({
    where: { id: claimId },
    include: {
      policy: { include: { insurer: true } },
      assignedAdjuster: true,
      inspections: { where: { deletedAt: null }, orderBy: { scheduledDate: "desc" } },
    },
  });
  const done = claim.inspections.find((i) => i.completedDate) ?? null;
  const p = claim.policy;
  let valuation: ReportPdfModel["valuation"];
  if (type === "FINAL") {
    const { items, settlement } = await recomputeSettlement(tx, claimId);
    valuation = {
      items: items.map((i) => ({
        description: i.itemDescription,
        category: i.category,
        claimed: moneyOut(i.claimedAmount)!,
        assessed: moneyOut(i.assessedAmount)!,
        deductions: fromKobo(toKobo(String(i.depreciationAmount)) + toKobo(String(i.bettermentDeduction))),
        net: moneyOut(i.netPayable)!,
        salvage: i.category === SALVAGE_CATEGORY,
      })),
      settlement,
      valueAtRisk: moneyOut(claim.valueAtRisk),
    };
  }
  const model: Omit<ReportPdfModel, "firm" | "approved" | "date" | "approver" | "version"> = {
    type,
    claim: {
      reference: claim.claimReference,
      insurerClaimNo: claim.insurerClaimNo,
      dateOfLoss: dateOut(claim.dateOfLoss)!,
      dateInstructed: dateOut(claim.dateInstructed)!,
      location: [claim.lossAddress, claim.lossLga, claim.lossState].filter(Boolean).join(", "),
      initialReserve: moneyOut(claim.initialReserve),
    },
    policy: {
      insuredName: p.insuredName,
      policyNumber: p.policyNumber,
      naicomUid: p.naicomUid,
      className: POLICY_TYPE_LABELS.find((t) => t.value === p.policyType)?.label ?? p.policyType,
      period: `${longDate(dateOut(p.startDate)!)} to ${longDate(dateOut(p.endDate)!)}`,
      sumInsured: moneyOut(p.sumInsured)!,
      excess: excessText(String(p.excessAmount), String(p.excessPercentage)),
    },
    insurer: { name: p.insurerName, address: p.insurer.address },
    broker: p.brokerName,
    adjuster: claim.assignedAdjuster ? { fullName: claim.assignedAdjuster.fullName, qualification: claim.assignedAdjuster.ciiQualification, licence: claim.assignedAdjuster.naicomLicenseNo } : null,
    inspection: done
      ? {
          completedAt: done.completedDate,
          gps: done.gpsLatitude != null && done.gpsLongitude != null ? `${Number(done.gpsLatitude).toFixed(5)}, ${Number(done.gpsLongitude).toFixed(5)}` : null,
          causeVerified: done.causeOfLossVerified,
          liabilityConfirmed: done.policyLiabilityConfirmed,
          thirdParty: done.thirdPartyInvolvement,
        }
      : null,
    sections: REPORT_SECTIONS[type].map((s) => ({ key: s.key, title: s.title, text: body.sections[s.key] ?? "" })),
    valuation,
  };
  return { claim, model };
}

type Snapshot = Awaited<ReturnType<typeof snapshot>>["model"];

/** A new draft starts from the previous version of the same report, else from what the claim already records. */
async function prefill(tx: Tx, claimId: number, type: ReportType): Promise<Body> {
  const previous = await tx.report.findFirst({ where: { claimId, type }, orderBy: { version: "desc" } });
  if (previous) return previous.body as Body;
  const claim = await tx.claim.findUniqueOrThrow({ where: { id: claimId }, include: { policy: true, inspections: { where: { deletedAt: null, completedDate: { not: null } }, orderBy: { completedDate: "desc" } } } });
  const prelim = await tx.report.findFirst({ where: { claimId, type: "PRELIMINARY", status: "APPROVED" }, orderBy: { version: "desc" } });
  const prelimBody = (prelim?.body as Body | undefined)?.sections ?? {};
  const notes = claim.inspections.map((i) => i.siteNotes).filter(Boolean).join("\n\n");
  const background = `We were instructed by ${claim.policy.insurerName} on ${dateOut(claim.dateInstructed)} to investigate and report on a claim by ${claim.policy.insuredName} under policy ${claim.policy.policyNumber}.`;
  const sections: Record<string, string> =
    type === "PRELIMINARY"
      ? { background, circumstances: claim.incidentDescription, inspection: notes }
      : {
          background: prelim ? `${background} Our preliminary report was issued on ${dateOut(prelim.reviewedAt)}.` : background,
          circumstances: prelimBody.circumstances ?? claim.incidentDescription,
          investigation: prelimBody.inspection ?? notes,
          cause: prelimBody.cause ?? "",
          liability: prelimBody.liability ?? "",
        };
  return { sections };
}

async function findReport(actor: AuthUser, claimId: number, reportId: number, tx: Tx | typeof prisma = prisma) {
  await findScopedClaim(actor, claimId, tx);
  const r = await tx.report.findFirst({ where: { id: reportId, claimId }, include });
  // Insurers see only signed-off reports; anything else is "not found" to them.
  if (!r || (actor.role === "INSURER" && r.status !== "APPROVED")) throw notFound("Report");
  return r;
}

export async function listReports(actor: AuthUser, claimId: number) {
  const claim = await findScopedClaim(actor, claimId);
  const staff = actor.role !== "INSURER";
  const rows = await prisma.report.findMany({
    where: { claimId, ...(staff ? {} : { status: "APPROVED" }) },
    include,
    orderBy: [{ type: "asc" }, { version: "desc" }],
  });
  const open = (t: ReportType) => rows.some((r) => r.type === t && (OPEN_REPORT as readonly string[]).includes(r.status));
  const approvedPrelim = rows.some((r) => r.type === "PRELIMINARY" && r.status === "APPROVED");
  const canStart = (t: ReportType) =>
    staff && CAN_START[t].includes(claim.status) && !open(t) && !(t === "PRELIMINARY" && approvedPrelim);
  return {
    data: rows.map((r) => reportOut(r, staff)),
    sections: REPORT_SECTIONS,
    canStart: { PRELIMINARY: canStart("PRELIMINARY"), FINAL: canStart("FINAL") },
  };
}

export async function createReport(actor: AuthUser, claimId: number, type: ReportType, ip: string | null) {
  const created = await prisma.$transaction(async (tx) => {
    const claim = await claimForStaffWrite(actor, claimId, tx);
    const existing = await tx.report.findMany({ where: { claimId, type } });
    if (existing.some((r) => (OPEN_REPORT as readonly string[]).includes(r.status))) throw conflict("There is already a draft of this report. Carry on with it.");
    if (type === "PRELIMINARY" && existing.some((r) => r.status === "APPROVED")) throw conflict("The preliminary report has been signed off. Write the final report next.");
    if (!CAN_START[type].includes(claim.status)) {
      throw unprocessable(type === "PRELIMINARY" ? "A preliminary report is written once the inspection is scheduled or done." : "The final report is written after the investigation.");
    }
    const version = existing.reduce((m, r) => Math.max(m, r.version), 0) + 1;
    const report = await tx.report.create({ data: { claimId, type, version, body: await prefill(tx, claimId, type), draftedById: actor.id }, include });
    await recordAudit({ action: "REPORT_DRAFTED", entityType: "Report", entityId: report.id, claimId, userId: actor.id, details: { type, version }, ipAddress: ip }, tx);
    return report;
  });
  return reportOut(created, true);
}

function editable(r: Report) {
  if (r.status !== "DRAFT" && r.status !== "RETURNED") throw unprocessable("Only a draft or a returned report can be edited.");
}

export async function updateReport(actor: AuthUser, claimId: number, reportId: number, body: Body, ip: string | null) {
  const known = new Set(REPORT_SECTIONS.PRELIMINARY.concat(REPORT_SECTIONS.FINAL).map((s) => s.key));
  const unknown = Object.keys(body.sections).filter((k) => !known.has(k));
  if (unknown.length) throw unprocessable(`Unknown section: ${unknown.join(", ")}.`);
  const updated = await prisma.$transaction(async (tx) => {
    await claimForStaffWrite(actor, claimId, tx);
    const r = await findReport(actor, claimId, reportId, tx);
    editable(r);
    const merged = { sections: { ...(r.body as Body).sections, ...body.sections } };
    const after = await tx.report.update({ where: { id: reportId }, data: { body: merged }, include });
    await recordAudit({ action: "REPORT_EDITED", entityType: "Report", entityId: reportId, claimId, userId: actor.id, details: { sections: Object.keys(body.sections) }, ipAddress: ip }, tx);
    return after;
  });
  return reportOut(updated, true);
}

export async function submitReport(actor: AuthUser, claimId: number, reportId: number, ip: string | null) {
  const submitted = await prisma.$transaction(async (tx) => {
    const claim = await claimForStaffWrite(actor, claimId, tx);
    const r = await findReport(actor, claimId, reportId, tx);
    editable(r);
    const body = r.body as Body;
    const missing = REPORT_SECTIONS[r.type].filter((s) => s.required && !(body.sections[s.key] ?? "").trim());
    if (missing.length) {
      throw new AppError(422, "INCOMPLETE", `Fill in: ${missing.map((m) => m.title).join(", ")}.`, missing.map((m) => ({ path: m.key, message: "Required before submitting." })));
    }
    if (r.type === "PRELIMINARY" && claim.status !== "UNDER_INVESTIGATION") {
      throw unprocessable("Record the site inspection first: the preliminary report is submitted once the claim is under investigation.");
    }
    if (r.type === "FINAL") {
      if ((await tx.valuationItem.count({ where: { claimId } })) === 0) throw unprocessable("Add the schedule of loss before submitting the final report.");
      if (!["PRELIM_REPORT_SUBMITTED", "AWAITING_DOCUMENTS", "FINAL_REPORT_DRAFTED"].includes(claim.status)) {
        throw unprocessable("The preliminary report must be signed off before the final report is submitted.");
      }
      // Submitting the final report means the documents are complete and the draft is done.
      if (claim.status !== "FINAL_REPORT_DRAFTED") await moveClaimStatus(tx, actor, claimId, "FINAL_REPORT_DRAFTED", { ipAddress: ip, viaReport: true });
      await moveClaimStatus(tx, actor, claimId, "PENDING_SIGNOFF", { ipAddress: ip, viaReport: true });
    }
    const { model } = await snapshot(tx, claimId, r.type, body);
    const after = await tx.report.update({
      where: { id: reportId },
      data: { status: "SUBMITTED", submittedAt: new Date(), figures: model as unknown as Prisma.InputJsonValue, returnReason: null },
      include,
    });
    await recordAudit({ action: "REPORT_SUBMITTED", entityType: "Report", entityId: reportId, claimId, userId: actor.id, details: { type: r.type, version: r.version, netRecommended: model.valuation?.settlement.netRecommended ?? null }, ipAddress: ip }, tx);
    return after;
  });
  return reportOut(submitted, true);
}

/** Revives Date fields in a stored snapshot (JSON keeps them as strings). */
function revive(s: Snapshot): Snapshot {
  return { ...s, inspection: s.inspection ? { ...s.inspection, completedAt: s.inspection.completedAt ? new Date(s.inspection.completedAt) : null } : null };
}

export async function approveReport(actor: AuthUser, claimId: number, reportId: number, note: string | undefined, ip: string | null) {
  if (actor.role !== "ADMIN") throw forbidden("Only the principal adjuster signs off reports.");
  const approved = await prisma.$transaction(async (tx) => {
    const claim = await findScopedClaim(actor, claimId, tx);
    const r = await findReport(actor, claimId, reportId, tx);
    if (r.status !== "SUBMITTED") throw unprocessable("Only a submitted report can be signed off.");
    // Maker-checker: someone other than the author signs off, unless there is no other active principal.
    let selfApprovalNote: string | null = null;
    if (r.draftedById === actor.id) {
      const others = await tx.user.count({ where: { role: "ADMIN", isActive: true, id: { not: actor.id } } });
      if (others > 0) throw forbidden("You wrote this report, so another principal adjuster must sign it off.");
      if (!note?.trim()) throw unprocessable("You are signing off your own report. Add a note saying why (you are the only principal adjuster).");
      selfApprovalNote = note.trim();
    }
    if (r.type === "FINAL" && claim.status !== "PENDING_SIGNOFF") throw unprocessable("The claim is no longer pending sign-off.");
    const now = new Date();
    const me = await tx.user.findUniqueOrThrow({ where: { id: actor.id } });
    const pdf = await buildReportPdf({
      ...revive(r.figures as unknown as Snapshot),
      firm: firm(),
      version: r.version,
      approved: true,
      date: now,
      approver: { fullName: me.fullName, qualification: me.ciiQualification, approvedAt: now },
    });
    const sha = createHash("sha256").update(pdf).digest("hex");
    const updated = await tx.report.updateMany({
      where: { id: reportId, status: "SUBMITTED" },
      data: { status: "APPROVED", reviewedById: actor.id, reviewedAt: now, pdfData: new Uint8Array(pdf), pdfSha256: sha, selfApprovalNote },
    });
    if (updated.count !== 1) throw conflict("This report changed while you were looking at it. Refresh and try again.");
    if (r.type === "PRELIMINARY" && claim.status === "UNDER_INVESTIGATION") {
      await moveClaimStatus(tx, actor, claimId, "PRELIM_REPORT_SUBMITTED", { ipAddress: ip, viaReport: true });
    }
    await recordAudit({ action: "REPORT_APPROVED", entityType: "Report", entityId: reportId, claimId, userId: actor.id, details: { type: r.type, version: r.version, pdfSha256: sha, selfApprovalNote }, ipAddress: ip }, tx);
    return tx.report.findUniqueOrThrow({ where: { id: reportId }, include });
  });
  return reportOut(approved, true);
}

export async function returnReport(actor: AuthUser, claimId: number, reportId: number, reason: string, ip: string | null) {
  if (actor.role !== "ADMIN") throw forbidden("Only the principal adjuster returns reports.");
  const returned = await prisma.$transaction(async (tx) => {
    const claim = await findScopedClaim(actor, claimId, tx);
    const r = await findReport(actor, claimId, reportId, tx);
    if (r.status !== "SUBMITTED") throw unprocessable("Only a submitted report can be returned.");
    const after = await tx.report.update({ where: { id: reportId }, data: { status: "RETURNED", returnReason: reason, reviewedById: actor.id, reviewedAt: new Date() }, include });
    if (r.type === "FINAL" && claim.status === "PENDING_SIGNOFF") {
      await moveClaimStatus(tx, actor, claimId, "FINAL_REPORT_DRAFTED", { reason, ipAddress: ip, viaReport: true });
    }
    await recordAudit({ action: "REPORT_RETURNED", entityType: "Report", entityId: reportId, claimId, userId: actor.id, details: { type: r.type, version: r.version, reason }, ipAddress: ip }, tx);
    return after;
  });
  return reportOut(returned, true);
}

/**
 * The PDF: a signed-off report's stored file (checked against its hash), else a DRAFT preview built from the
 * current text (from the frozen snapshot once submitted).
 */
export async function reportPdf(actor: AuthUser, claimId: number, reportId: number) {
  const r = await findReport(actor, claimId, reportId);
  const name = `${r.type === "FINAL" ? "Final" : "Preliminary"} report ${(await prisma.claim.findUniqueOrThrow({ where: { id: claimId } })).claimReference}${r.version > 1 ? ` v${r.version}` : ""}`;
  if (r.status === "APPROVED") {
    if (!r.pdfData || !r.pdfSha256) throw new AppError(500, "PDF_MISSING", "The signed-off PDF is missing.");
    const data = Buffer.from(r.pdfData);
    if (createHash("sha256").update(data).digest("hex") !== r.pdfSha256) {
      throw new AppError(500, "PDF_ALTERED", "The stored PDF no longer matches the one that was signed off. It has not been sent.");
    }
    return { data, fileName: `${name}.pdf` };
  }
  if (actor.role === "INSURER") throw notFound("Report");
  const model = r.status === "SUBMITTED" && r.figures ? revive(r.figures as unknown as Snapshot) : (await prisma.$transaction((tx) => snapshot(tx, claimId, r.type, r.body as Body))).model;
  const data = await buildReportPdf({ ...model, firm: firm(), version: r.version, approved: false, date: new Date(), approver: null });
  return { data, fileName: `${name} DRAFT.pdf` };
}

/** Used by the seed to sign off reports with the same code path as the app. */
export { snapshot as reportSnapshot };
