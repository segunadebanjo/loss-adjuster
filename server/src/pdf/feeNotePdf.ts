import { nairaInWords } from "../lib/amountInWords.js";
import type { FeeNoteFigures } from "../lib/feeNote.js";
import type { Firm } from "../lib/firm.js";
import { contentWidth, finish, heading, INK, keyValues, letterhead, longDate, MARGIN, money, MUTED, newDoc, table, title, toBuffer } from "./common.js";

export interface FeeNotePdfModel {
  firm: Firm;
  number: string;
  status: "DRAFT" | "ISSUED" | "PAID" | "CANCELLED";
  date: Date;
  insurer: { name: string; address: string | null };
  claim: { reference: string; insurerClaimNo: string | null; insuredName: string; policyNumber: string; dateOfLoss: string; className: string };
  expenses: Array<{ description: string; amount: string }>;
  figures: FeeNoteFigures;
  notes: string | null;
  /** Lead plus followers when the policy is co-insured (each is debited its share); empty otherwise. */
  coInsurers?: Array<{ name: string; role: "LEAD" | "FOLLOWER"; sharePercent: string }>;
  coAdjuster?: { firmName: string; naicomNo: string | null; splitPercent: string | null } | null;
  amountInWords?: string;
}

export async function buildFeeNotePdf(m: FeeNotePdfModel): Promise<Buffer> {
  const doc = newDoc(`Fee note ${m.number}`, { author: m.firm.name, subject: `Fee note for ${m.claim.reference}`, createdAt: m.date });
  letterhead(doc, m.firm);
  title(doc, "Fee Note", `No. ${m.number} · ${longDate(m.date)}`);

  doc.font("Helvetica").fontSize(10).fillColor(INK).text(`To: ${m.insurer.name}`);
  if (m.insurer.address) doc.fillColor(MUTED).text(m.insurer.address);
  doc.moveDown(0.8);

  keyValues(doc, [
    ["Our claim ref", m.claim.reference],
    ["Your claim ref", m.claim.insurerClaimNo],
    ["Insured", m.claim.insuredName],
    ["Policy number", m.claim.policyNumber],
    ["Class / date of loss", `${m.claim.className} · ${longDate(m.claim.dateOfLoss)}`],
  ]);

  heading(doc, "Charges");
  const f = m.figures;
  table(
    doc,
    [{ header: "Description", width: 0.72 }, { header: "Amount", width: 0.28, align: "right" }],
    [
      ["Professional fee for loss adjusting services", money(f.professionalFee)],
      ...m.expenses.map((e) => [`Expense: ${e.description}`, money(e.amount)]),
      ["Subtotal", money(f.grossAmount)],
      [`VAT at ${Number(f.vatRate)}%`, money(f.vatAmount)],
      ["Total due (including VAT)", money(f.invoiceTotal)],
      [`Less withholding tax at ${Number(f.whtRate)}% of the professional fee`, `(${money(f.whtAmount)})`],
      ["Net amount payable", money(f.netPayable)],
    ],
    { boldLastRow: true },
  );
  doc.font("Helvetica-Oblique").fontSize(9.5).fillColor(INK).text(`Amount in words: ${nairaInWords(f.netPayable)}.`, MARGIN, doc.y, { width: contentWidth(doc) });
  doc.moveDown(0.8);

  heading(doc, "Payment details");
  keyValues(doc, [
    ["Bank", m.firm.bank.name],
    ["Account name", m.firm.bank.accountName],
    ["Account number", m.firm.bank.accountNumber],
    ["Tax ID (TIN)", m.firm.tin],
  ]);
  doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(
    `Please quote ${m.number} with your payment and send the withholding tax credit note to ${m.firm.email}.`,
    MARGIN, doc.y, { width: contentWidth(doc) },
  );
  if (m.notes) {
    doc.moveDown(0.6);
    doc.font("Helvetica").fontSize(9).fillColor(INK).text(m.notes, { width: contentWidth(doc) });
  }

  const mark = m.status === "DRAFT" ? "DRAFT" : m.status === "CANCELLED" ? "CANCELLED" : undefined;
  finish(doc, `${m.firm.name} · ${m.number} · ${m.claim.reference}`, mark);
  return toBuffer(doc);
}
