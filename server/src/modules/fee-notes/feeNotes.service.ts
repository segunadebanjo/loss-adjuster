import { createHash } from "node:crypto";
import { z } from "zod";
import type { FeeNote, Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma, type Tx } from "../../lib/prisma.js";
import { diffRecords, recordAudit } from "../../lib/audit.js";
import { AppError, conflict, notFound, unprocessable } from "../../lib/errors.js";
import { dateIn, dateOut, todayLagos } from "../../lib/dates.js";
import { computeFeeNote } from "../../lib/feeNote.js";
import { firm } from "../../lib/firm.js";
import { fromKobo, moneyOut, toKobo } from "../../lib/money.js";
import { zDate, zMoney, zRequiredText, zText } from "../../lib/validation.js";
import { buildFeeNotePdf } from "../../pdf/feeNotePdf.js";
import type { AuthUser } from "../../middleware/authenticate.js";
import { POLICY_TYPE_LABELS, findScopedClaim } from "../claims/claims.service.js";

const expense = z.object({ description: zRequiredText(200, "Describe the expense."), amount: zMoney });
export const feeNoteInput = z.object({
  professionalFee: zMoney.refine((v) => toKobo(v) > 0n, "Enter the professional fee."),
  expenses: z.array(expense).max(20).default([]),
  notes: zText(2000),
});
export const feeNoteUpdate = z.object({ professionalFee: feeNoteInput.shape.professionalFee.optional(), expenses: z.array(expense).max(20).optional(), notes: zText(2000) });
export const paidInput = z.object({ paidOn: zDate, reference: zText(128) });
export const cancelInput = z.object({ reason: zRequiredText(1000, "Say why this fee note is cancelled.") });

type Expense = { description: string; amount: string };

const include = { claim: { select: { claimReference: true } } } as const;

function feeNoteOut(f: FeeNote) {
  return {
    id: f.id,
    feeNoteNo: f.status === "DRAFT" ? null : f.feeNoteNo,
    status: f.status,
    professionalFee: moneyOut(f.professionalFee)!,
    expenses: f.expenses as Expense[],
    vatRate: f.vatRate.toFixed(2),
    whtRate: f.whtRate.toFixed(2),
    grossAmount: moneyOut(f.grossAmount)!,
    vatAmount: moneyOut(f.vatAmount)!,
    invoiceTotal: fromKobo(toKobo(String(f.grossAmount)) + toKobo(String(f.vatAmount))),
    whtAmount: moneyOut(f.whtAmount)!,
    netPayable: moneyOut(f.netPayable)!,
    notes: f.notes,
    issuedAt: f.issuedAt?.toISOString() ?? null,
    paidAt: f.paidAt?.toISOString() ?? null,
    paymentReference: f.paymentReference,
    cancelReason: f.cancelReason,
    pdfSha256: f.pdfSha256,
    createdAt: f.createdAt.toISOString(),
  };
}

/** Rates are copied onto the note when it is drafted, so a later rate change never alters it. */
function figures(fee: string, expenses: Expense[], vatRate: string, whtRate: string) {
  const f = computeFeeNote({ professionalFee: fee, expenses, vatRate, whtRate });
  return { professionalFee: f.professionalFee, expenses, vatRate: f.vatRate, whtRate: f.whtRate, grossAmount: f.grossAmount, vatAmount: f.vatAmount, whtAmount: f.whtAmount, netPayable: f.netPayable };
}

/** The claim's fee is what has been billed on live fee notes. */
async function syncAdjusterFee(tx: Tx, claimId: number) {
  const live = await tx.feeNote.findMany({ where: { claimId, status: { in: ["ISSUED", "PAID"] } }, select: { professionalFee: true } });
  const total = live.reduce((s, f) => s + toKobo(String(f.professionalFee)), 0n);
  await tx.claim.update({ where: { id: claimId }, data: { adjusterFee: live.length ? fromKobo(total) : null } });
}

async function nextFeeNoteNo(tx: Tx, year: number) {
  await tx.$executeRaw`INSERT INTO document_sequences (kind, year, last_no) VALUES ('FEE_NOTE', ${year}, 1)
    ON DUPLICATE KEY UPDATE last_no = last_no + 1`;
  const row = await tx.documentSequence.findUniqueOrThrow({ where: { kind_year: { kind: "FEE_NOTE", year } } });
  return `FN-${year}-${String(row.lastNo).padStart(4, "0")}`;
}

async function findFeeNote(actor: AuthUser, claimId: number, id: number, tx: Tx | typeof prisma = prisma) {
  await findScopedClaim(actor, claimId, tx);
  const f = await tx.feeNote.findFirst({ where: { id, claimId } });
  if (!f || (actor.role === "INSURER" && (f.status === "DRAFT" || f.status === "CANCELLED"))) throw notFound("Fee note");
  return f;
}

export async function listFeeNotes(actor: AuthUser, claimId: number) {
  await findScopedClaim(actor, claimId);
  const where: Prisma.FeeNoteWhereInput = { claimId, ...(actor.role === "INSURER" ? { status: { in: ["ISSUED", "PAID"] } } : {}) };
  const rows = await prisma.feeNote.findMany({ where, orderBy: { createdAt: "desc" } });
  return { data: rows.map(feeNoteOut), rates: { vat: env.VAT_RATE.toFixed(2), wht: env.WHT_RATE.toFixed(2) } };
}

export async function createFeeNote(actor: AuthUser, claimId: number, input: z.infer<typeof feeNoteInput>, ip: string | null) {
  const created = await prisma.$transaction(async (tx) => {
    await findScopedClaim(actor, claimId, tx);
    const f = await tx.feeNote.create({
      data: {
        claimId,
        // The real number is given when the note is issued, so issued numbers have no gaps.
        feeNoteNo: `DRAFT-${claimId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ...figures(input.professionalFee, input.expenses, String(env.VAT_RATE), String(env.WHT_RATE)),
        notes: input.notes ?? null,
        createdById: actor.id,
      },
    });
    await recordAudit({ action: "FEE_NOTE_DRAFTED", entityType: "FeeNote", entityId: f.id, claimId, userId: actor.id, details: { professionalFee: input.professionalFee, netPayable: moneyOut(f.netPayable) }, ipAddress: ip }, tx);
    return f;
  });
  return feeNoteOut(created);
}

export async function updateFeeNote(actor: AuthUser, claimId: number, id: number, input: z.infer<typeof feeNoteUpdate>, ip: string | null) {
  const updated = await prisma.$transaction(async (tx) => {
    const before = await findFeeNote(actor, claimId, id, tx);
    if (before.status !== "DRAFT") throw unprocessable("An issued fee note can't be changed. Cancel it and raise a new one.");
    const fee = input.professionalFee ?? String(before.professionalFee);
    const expenses = input.expenses ?? (before.expenses as Expense[]);
    const after = await tx.feeNote.update({
      where: { id },
      data: { ...figures(fee, expenses, String(before.vatRate), String(before.whtRate)), notes: input.notes !== undefined ? input.notes : before.notes },
    });
    const changes = diffRecords(before, after, ["professionalFee", "grossAmount", "netPayable", "notes"]);
    if (Object.keys(changes).length) await recordAudit({ action: "FEE_NOTE_UPDATED", entityType: "FeeNote", entityId: id, claimId, userId: actor.id, details: { changes }, ipAddress: ip }, tx);
    return after;
  });
  return feeNoteOut(updated);
}

async function pdfFor(tx: Tx | typeof prisma, f: FeeNote, date: Date, status: FeeNote["status"], number: string) {
  const claim = await tx.claim.findUniqueOrThrow({ where: { id: f.claimId }, include: { policy: { include: { insurer: true } } } });
  const fig = computeFeeNote({ professionalFee: String(f.professionalFee), expenses: f.expenses as Expense[], vatRate: String(f.vatRate), whtRate: String(f.whtRate) });
  return buildFeeNotePdf({
    firm: firm(),
    number,
    status,
    date,
    insurer: { name: claim.policy.insurerName, address: claim.policy.insurer.address },
    claim: {
      reference: claim.claimReference,
      insurerClaimNo: claim.insurerClaimNo,
      insuredName: claim.policy.insuredName,
      policyNumber: claim.policy.policyNumber,
      dateOfLoss: dateOut(claim.dateOfLoss)!,
      className: POLICY_TYPE_LABELS.find((t) => t.value === claim.policy.policyType)?.label ?? claim.policy.policyType,
    },
    expenses: f.expenses as Expense[],
    figures: fig,
    notes: f.notes,
  });
}

export async function issueFeeNote(actor: AuthUser, claimId: number, id: number, ip: string | null) {
  const issued = await prisma.$transaction(async (tx) => {
    const f = await findFeeNote(actor, claimId, id, tx);
    if (f.status !== "DRAFT") throw unprocessable("Only a draft fee note can be issued.");
    const now = new Date();
    const number = await nextFeeNoteNo(tx, Number(todayLagos(now).slice(0, 4)));
    const pdf = await pdfFor(tx, f, now, "ISSUED", number);
    const sha = createHash("sha256").update(pdf).digest("hex");
    const { count } = await tx.feeNote.updateMany({
      where: { id, status: "DRAFT" },
      data: { status: "ISSUED", feeNoteNo: number, issuedAt: now, issuedById: actor.id, pdfData: new Uint8Array(pdf), pdfSha256: sha },
    });
    if (count !== 1) throw conflict("This fee note changed while you were looking at it. Refresh and try again.");
    await syncAdjusterFee(tx, claimId);
    await recordAudit({ action: "FEE_NOTE_ISSUED", entityType: "FeeNote", entityId: id, claimId, userId: actor.id, details: { feeNoteNo: number, netPayable: moneyOut(f.netPayable), pdfSha256: sha }, ipAddress: ip }, tx);
    return tx.feeNote.findUniqueOrThrow({ where: { id } });
  });
  return feeNoteOut(issued);
}

export async function markPaid(actor: AuthUser, claimId: number, id: number, input: z.infer<typeof paidInput>, ip: string | null) {
  if (input.paidOn > todayLagos()) throw unprocessable("The payment date can't be in the future.");
  const paid = await prisma.$transaction(async (tx) => {
    const f = await findFeeNote(actor, claimId, id, tx);
    if (f.status !== "ISSUED") throw unprocessable("Only an issued fee note can be marked paid.");
    if (input.paidOn < todayLagos(f.issuedAt!)) throw unprocessable("The payment date can't be before the fee note was issued.");
    const after = await tx.feeNote.update({ where: { id }, data: { status: "PAID", paidAt: dateIn(input.paidOn), paymentReference: input.reference ?? null } });
    await recordAudit({ action: "FEE_NOTE_PAID", entityType: "FeeNote", entityId: id, claimId, userId: actor.id, details: { feeNoteNo: f.feeNoteNo, paidOn: input.paidOn, reference: input.reference ?? null }, ipAddress: ip }, tx);
    return after;
  });
  return feeNoteOut(paid);
}

/** Cancelling keeps the issued PDF and number (no gaps); the claim's fee drops it. */
export async function cancelFeeNote(actor: AuthUser, claimId: number, id: number, reason: string, ip: string | null) {
  const cancelled = await prisma.$transaction(async (tx) => {
    const f = await findFeeNote(actor, claimId, id, tx);
    if (f.status !== "DRAFT" && f.status !== "ISSUED") throw unprocessable("A paid or cancelled fee note can't be cancelled.");
    const after = await tx.feeNote.update({ where: { id }, data: { status: "CANCELLED", cancelReason: reason } });
    await syncAdjusterFee(tx, claimId);
    await recordAudit({ action: "FEE_NOTE_CANCELLED", entityType: "FeeNote", entityId: id, claimId, userId: actor.id, details: { feeNoteNo: f.status === "DRAFT" ? null : f.feeNoteNo, reason }, ipAddress: ip }, tx);
    return after;
  });
  return feeNoteOut(cancelled);
}

export async function feeNotePdf(actor: AuthUser, claimId: number, id: number) {
  const f = await findFeeNote(actor, claimId, id);
  if (f.status === "DRAFT") {
    return { data: await pdfFor(prisma, f, new Date(), "DRAFT", "DRAFT"), fileName: `Fee note DRAFT.pdf` };
  }
  if (!f.pdfData || !f.pdfSha256) throw new AppError(500, "PDF_MISSING", "The issued PDF is missing.");
  const data = Buffer.from(f.pdfData);
  if (createHash("sha256").update(data).digest("hex") !== f.pdfSha256) {
    throw new AppError(500, "PDF_ALTERED", "The stored PDF no longer matches the one that was issued. It has not been sent.");
  }
  return { data, fileName: `${f.feeNoteNo}.pdf` };
}

export { include as feeNoteInclude };
