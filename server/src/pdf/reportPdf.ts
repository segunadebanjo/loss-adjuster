import type { Firm } from "../lib/firm.js";
import type { Settlement } from "../lib/settlement.js";
import { contentWidth, finish, heading, keyValues, letterhead, longDate, MARGIN, money, MUTED, newDoc, paragraph, table, title, toBuffer, INK } from "./common.js";

export interface ReportPdfModel {
  firm: Firm;
  type: "PRELIMINARY" | "FINAL";
  version: number;
  approved: boolean;
  /** Approval date, or the date a preview was made. */
  date: Date;
  claim: {
    reference: string;
    insurerClaimNo: string | null;
    dateOfLoss: string;
    dateInstructed: string;
    location: string;
    initialReserve: string | null;
  };
  policy: { insuredName: string; policyNumber: string; naicomUid: string; className: string; period: string; sumInsured: string; excess: string };
  /** sharePercent and the co-insurance fields are absent from snapshots frozen before they existed. */
  insurer: { name: string; address: string | null; sharePercent?: string };
  coInsurers?: Array<{ name: string; role: "LEAD" | "FOLLOWER"; sharePercent: string }>;
  coAdjuster?: { firmName: string; naicomNo: string | null; splitPercent: string | null } | null;
  broker: string | null;
  adjuster: { fullName: string; qualification: string | null; licence: string | null } | null;
  approver: { fullName: string; qualification: string | null; approvedAt: Date } | null;
  /** Every principal who signed off (the approval matrix may need more than one). */
  approvers?: Array<{ fullName: string; qualification: string | null; approvedAt: Date }>;
  approvalTier?: { label: string; requiredApprovals: number } | null;
  inspection: { completedAt: Date | null; visitedOn?: string | null; gps: string | null; causeVerified: boolean; liabilityConfirmed: boolean; thirdParty: boolean } | null;
  sections: Array<{ key: string; title: string; text: string }>;
  valuation?: { items: Array<{ description: string; category: string; claimed: string; assessed: string; deductions: string; net: string; salvage: boolean }>; settlement: Settlement; valueAtRisk: string | null };
}

const TITLES = { PRELIMINARY: "Preliminary Loss Adjustment Report", FINAL: "Final Loss Adjustment Report" };

function scheduleOfLoss(doc: PDFKit.PDFDocument, v: NonNullable<ReportPdfModel["valuation"]>, sumInsured: string) {
  heading(doc, "Schedule of loss");
  table(
    doc,
    [
      { header: "Item", width: 0.36 },
      { header: "Claimed", width: 0.16, align: "right" },
      { header: "Assessed", width: 0.16, align: "right" },
      { header: "Deductions", width: 0.16, align: "right" },
      { header: "Net", width: 0.16, align: "right" },
    ],
    [
      ...v.items.map((i) => [`${i.description}\n${i.category}`, i.salvage ? "-" : money(i.claimed), money(i.assessed), i.salvage ? "-" : money(i.deductions), i.salvage ? `(${money(i.net)})` : money(i.net)]),
      ["Totals", money(v.settlement.totalClaimed), money(v.settlement.totalAssessed), "", money(v.settlement.grossLoss)],
    ],
    { boldLastRow: true, fontSize: 8.5 },
  );

  const s = v.settlement;
  heading(doc, "Adjustment");
  const rows: string[][] = [
    ["Adjusted loss (after depreciation, betterment and salvage)", money(s.grossLoss)],
    s.average.applied
      ? [`Less average: sum insured ${money(sumInsured)} / value at risk ${money(v.valueAtRisk)} = ${s.average.ratioPercent}%`, `(${money(s.average.reduction)})`]
      : [`Average: ${s.average.reason}`, money("0.00")],
    ["Loss after average", money(s.lossAfterAverage)],
    [
      s.excess.basis === "NONE" ? "Excess: none" : `Less excess (${s.excess.basis === "PERCENTAGE" ? `${Number(s.excess.percentage)}% of the loss` : "fixed amount"}, the greater applies)`,
      `(${money(s.excess.applied)})`,
    ],
    [`Net recommended settlement${s.cappedAtSumInsured ? " (limited to the sum insured)" : ""}`, money(s.netRecommended)],
  ];
  table(doc, [{ header: "", width: 0.72 }, { header: "Amount", width: 0.28, align: "right" }], rows, { boldLastRow: true });
}

export async function buildReportPdf(m: ReportPdfModel): Promise<Buffer> {
  const name = TITLES[m.type];
  const doc = newDoc(`${name} ${m.claim.reference}`, { author: m.firm.name, subject: `${m.policy.insuredName} - ${m.claim.reference}`, createdAt: m.date });
  letterhead(doc, m.firm);
  title(doc, name, `Our ref ${m.claim.reference}${m.claim.insurerClaimNo ? ` · Your ref ${m.claim.insurerClaimNo}` : ""} · ${longDate(m.date)}${m.version > 1 ? ` · Version ${m.version}` : ""}`);

  doc.font("Helvetica").fontSize(10).fillColor(INK).text(`To: ${m.insurer.name}`);
  if (m.insurer.address) doc.fillColor(MUTED).text(m.insurer.address);
  if (m.broker) doc.fillColor(INK).text(`Through: ${m.broker}`);
  doc.moveDown(0.8);

  heading(doc, "Claim details");
  keyValues(doc, [
    ["Insured", m.policy.insuredName],
    ["Policy number", m.policy.policyNumber],
    ["NAICOM policy UID", m.policy.naicomUid],
    ["Class of insurance", m.policy.className],
    ["Period of insurance", m.policy.period],
    ["Sum insured", money(m.policy.sumInsured)],
    ["Excess", m.policy.excess],
    ["Date of loss", longDate(m.claim.dateOfLoss)],
    ["Date instructed", longDate(m.claim.dateInstructed)],
    ["Location of loss", m.claim.location],
    ...(m.type === "PRELIMINARY" ? ([["Insurer's reserve", money(m.claim.initialReserve)]] as Array<[string, string]>) : []),
    ["Loss adjuster", m.adjuster ? [m.adjuster.fullName, m.adjuster.qualification].filter(Boolean).join(", ") : "-"],
  ]);

  for (const s of m.sections) {
    if (!s.text.trim()) continue;
    heading(doc, s.title);
    paragraph(doc, s.text);
    if (s.key === "inspection" || s.key === "investigation") {
      if (m.inspection) {
        keyValues(doc, [
          ["Site inspected", m.inspection.completedAt ? longDate(m.inspection.completedAt) : "Not yet inspected"],
          ["GPS location", m.inspection.gps],
          ["Cause of loss verified", m.inspection.causeVerified ? "Yes" : "No"],
          ["Policy liability confirmed", m.inspection.liabilityConfirmed ? "Yes" : "No"],
          ["Third party involved", m.inspection.thirdParty ? "Yes" : "No"],
        ]);
      }
    }
    if (s.key === "quantum" && m.valuation) scheduleOfLoss(doc, m.valuation, m.policy.sumInsured);
  }

  doc.moveDown(1);
  doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(MUTED).text(
    "This report is issued without prejudice to the terms, conditions and exceptions of the policy, and is based on the information and documents available to us at the date of writing.",
    MARGIN, doc.y, { width: contentWidth(doc) },
  );
  doc.moveDown(1.2);

  // Signatures.
  const colW = contentWidth(doc) / 2 - 10;
  const y = doc.y;
  const sign = (x: number, label: string, who: string, role: string, when: string) => {
    doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(label, x, y, { width: colW });
    doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(who, x, doc.y + 2, { width: colW });
    doc.font("Helvetica").fontSize(9).fillColor(INK).text(role, x, doc.y, { width: colW });
    doc.fillColor(MUTED).text(when, x, doc.y, { width: colW });
  };
  sign(MARGIN, "Prepared by", m.adjuster ? [m.adjuster.fullName, m.adjuster.qualification].filter(Boolean).join(", ") : "-", `Loss Adjuster${m.adjuster?.licence ? ` · ${m.adjuster.licence}` : ""}`, "");
  const afterLeft = doc.y;
  sign(MARGIN + colW + 20, "Approved by", m.approver ? (m.approvers?.length ? m.approvers : [m.approver]).map((a) => [a.fullName, a.qualification].filter(Boolean).join(", ")).join("; ") : "Awaiting approval", "Principal Adjuster", m.approver ? `Signed off electronically on ${longDate(m.approver.approvedAt)}` : "");
  doc.y = Math.max(afterLeft, doc.y);

  finish(doc, `${m.firm.name} · ${m.claim.reference} · ${name}${m.version > 1 ? ` v${m.version}` : ""}`, m.approved ? undefined : "DRAFT");
  return toBuffer(doc);
}
