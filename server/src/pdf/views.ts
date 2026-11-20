import { readFileSync } from "node:fs";
import path from "node:path";
import { apportion } from "../lib/apportion.js";
import { fromKobo, toKobo } from "../lib/money.js";
import type { Firm } from "../lib/firm.js";
import type { FeeNotePdfModel } from "./feeNotePdf.js";
import type { ReportPdfModel } from "./reportPdf.js";
import Handlebars from "handlebars";
import { formatDate } from "./handlebars.js";

/** Typed text for a template's {{field}}: escaped here, with line breaks kept as <br>, so the template needn't care. */
const text = (t: string | undefined) => new Handlebars.SafeString(Handlebars.escapeExpression(t ?? "").replace(/\r?\n/g, "<br>"));

/** The firm as the templates see it; the logo is inlined so the page needs no network. */
function firmView(f: Firm) {
  let logoDataUri: string | null = null;
  if (f.logoPath) {
    const ext = path.extname(f.logoPath).slice(1).toLowerCase();
    const mime = ext === "svg" ? "image/svg+xml" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
    logoDataUri = `data:${mime};base64,${readFileSync(f.logoPath).toString("base64")}`;
  }
  return { ...f, naicomRacNumber: f.naicomLicence, logoDataUri };
}

const firstParagraph = (t: string) => t.split(/\n\s*\n/)[0]?.trim() ?? "";
const join = (...parts: Array<string | undefined>) => parts.map((p) => p?.trim()).filter(Boolean).join("\n\n");

/** Everything loss-adjustment-report.template.html reads, built from a report snapshot. */
export function reportView(m: ReportPdfModel) {
  const sec = Object.fromEntries(m.sections.map((s) => [s.key, s.text])) as Record<string, string | undefined>;
  const v = m.valuation;
  const s = v?.settlement;
  const pct = (part: string, whole: string) => (toKobo(whole) > 0n ? (Number((toKobo(part) * 10000n) / toKobo(whole)) / 100).toFixed(2) : "0.00");
  const depreciation = s ? fromKobo(toKobo(s.totalDepreciation) + toKobo(s.totalBetterment)) : "0.00";
  const net = s?.netRecommended ?? m.claim.initialReserve ?? "0.00";
  const approvers = m.approvers?.length ? m.approvers : m.approver ? [m.approver] : [];
  return {
    reportType: m.type === "FINAL" ? "Final Loss Adjustment Report" : "Preliminary Loss Adjustment Report",
    reportTypeKey: m.type,
    claimReference: m.claim.reference,
    reportDate: formatDate(m.date),
    version: m.version,
    approved: m.approved,
    isDraft: !m.approved,
    firm: firmView(m.firm),
    claim: {
      ourReference: m.claim.reference,
      insurerReference: m.claim.insurerClaimNo ?? "",
      brokerName: m.broker ?? "",
      insuranceClass: m.policy.className,
      dateOfLoss: formatDate(m.claim.dateOfLoss),
      dateInstructed: formatDate(m.claim.dateInstructed),
      dateVisited: m.inspection?.visitedOn ? formatDate(m.inspection.visitedOn) : m.inspection?.completedAt ? formatDate(m.inspection.completedAt) : "Not yet visited",
      lossLocation: m.claim.location,
      initialReserve: m.claim.initialReserve,
    },
    insurer: { name: m.insurer.name, address: m.insurer.address, sharePercent: Number(m.insurer.sharePercent ?? "100").toString() },
    insured: { name: m.policy.insuredName },
    policy: {
      number: m.policy.policyNumber,
      naicomUid: m.policy.naicomUid,
      period: m.policy.period,
      startDate: m.policy.period.split(" to ")[0] ?? "",
      endDate: m.policy.period.split(" to ")[1] ?? "",
      sumInsured: m.policy.sumInsured,
      excessAmount: s?.excess.applied ?? "0.00",
      excessText: m.policy.excess,
    },
    coAdjuster: m.coAdjuster ? { firmName: m.coAdjuster.firmName, naicomRacNumber: m.coAdjuster.naicomNo ?? "", splitPercent: m.coAdjuster.splitPercent ? Number(m.coAdjuster.splitPercent).toString() : "" } : null,
    adjuster: m.adjuster,
    summary: {
      briefCircumstances: text(firstParagraph(sec.circumstances ?? "")),
      liabilityOpinion: text(firstParagraph(sec.liability ?? "")),
    },
    narrative: {
      instructionsAndSurvey: text(join(sec.background, sec.inspection ?? sec.investigation)),
      insuredAndRiskDescription: text(sec.risk),
      circumstancesAndCause: text(join(sec.circumstances, sec.cause)),
      policyLiabilityAnalysis: text(sec.liability),
      reserve: text(sec.reserve),
      quantum: text(sec.quantum),
      recommendation: text(sec.recommendation),
      conclusion: text(sec.conclusion),
      documentsRequired: text(sec.documents),
      nextSteps: text(sec.nextSteps),
    },
    sections: m.sections,
    inspection: m.inspection,
    quantum: {
      lineItems: (v?.items ?? []).filter((i) => !i.salvage).map((i) => ({ description: i.description, category: i.category, claimedAmount: i.claimed, assessedAmount: i.assessed, deductions: i.deductions, netAmount: i.net, remarks: i.category })),
      grossClaimed: s?.totalClaimed ?? "0.00",
      grossAssessed: s?.totalAssessed ?? "0.00",
      depreciationAmount: s && toKobo(depreciation) > 0n ? depreciation : null,
      depreciationRate: s ? pct(depreciation, s.totalAssessed) : "0.00",
      salvageValue: s && toKobo(s.salvage) > 0n ? s.salvage : null,
      adjustedLoss: s?.grossLoss ?? "0.00",
      averageApplied: s?.average.applied ?? false,
      averageRatioPercent: s?.average.ratioPercent ?? null,
      averageDeduction: s?.average.applied ? s.average.reduction : null,
      averageReason: s?.average.reason ?? "",
      valueAtRisk: v?.valueAtRisk ?? null,
      lossAfterAverage: s?.lossAfterAverage ?? "0.00",
      excessApplied: s?.excess.applied ?? "0.00",
      cappedAtSumInsured: s?.cappedAtSumInsured ?? false,
      netAdjustedPayable: net,
      savings: s?.savings ?? "0.00",
    },
    coInsurers: m.coInsurers?.length ? apportion(net, m.coInsurers).map((c) => ({ ...c, roleLabel: c.role === "LEAD" ? "Lead" : "Follower", sharePercent: Number(c.sharePercent).toString(), shareAmount: c.amount })) : [],
    approvers: approvers.map((a) => ({ ...a, approvedOn: formatDate(a.approvedAt) })),
    approvalTier: m.approvalTier ?? null,
  };
}

/** Everything fee-note.template.html reads, including the co-insurance debit schedule. */
export function feeNoteView(m: FeeNotePdfModel) {
  const f = m.figures;
  const shares = m.coInsurers ?? [];
  return {
    firm: firmView(m.firm),
    feeNoteNumber: m.number,
    status: m.status,
    isDraft: m.status === "DRAFT",
    isCancelled: m.status === "CANCELLED",
    feeNoteDate: formatDate(m.date),
    insurer: m.insurer,
    claim: { ...m.claim, ourReference: m.claim.reference, insurerReference: m.claim.insurerClaimNo ?? "", dateOfLoss: formatDate(m.claim.dateOfLoss) },
    fees: {
      professionalFee: f.professionalFee,
      expenses: m.expenses,
      totalExpenses: fromKobo(m.expenses.reduce((a, e) => a + toKobo(e.amount), 0n)),
      subtotal: f.grossAmount,
      vatRate: Number(f.vatRate).toString(),
      vatAmount: f.vatAmount,
      invoiceTotal: f.invoiceTotal,
      whtRate: Number(f.whtRate).toString(),
      whtAmount: f.whtAmount,
      netPayable: f.netPayable,
      amountInWords: m.amountInWords,
    },
    coAdjuster: m.coAdjuster
      ? (() => {
          const split = m.coAdjuster.splitPercent ?? "0";
          const theirs = apportion(f.professionalFee, [{ name: m.firm.name, role: "LEAD", sharePercent: fromKobo(10000n - toKobo(split)) }, { name: m.coAdjuster.firmName, role: "FOLLOWER", sharePercent: split }]);
          return { firmName: m.coAdjuster.firmName, naicomRacNumber: m.coAdjuster.naicomNo ?? "", splitPercent: Number(split).toString(), ourShare: theirs[0]!.amount, theirShare: theirs[1]!.amount };
        })()
      : null,
    // Each co-insurer is debited its share of every figure; residues go to the lead so the columns add up.
    coInsurers: shares.length
      ? shares.map((c, i) => ({
          name: c.name,
          role: c.role,
          roleLabel: c.role === "LEAD" ? "Lead" : "Follower",
          sharePercent: Number(c.sharePercent).toString(),
          gross: apportion(f.grossAmount, shares)[i]!.amount,
          vat: apportion(f.vatAmount, shares)[i]!.amount,
          invoiceTotal: apportion(f.invoiceTotal, shares)[i]!.amount,
          wht: apportion(f.whtAmount, shares)[i]!.amount,
          netPayable: apportion(f.netPayable, shares)[i]!.amount,
        }))
      : [],
    notes: text(m.notes ?? ""),
    bank: m.firm.bank,
  };
}
