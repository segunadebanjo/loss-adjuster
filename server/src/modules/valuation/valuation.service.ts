import { z } from "zod";
import type { ValuationItem } from "@prisma/client";
import { prisma, type Tx } from "../../lib/prisma.js";
import { diffRecords, recordAudit } from "../../lib/audit.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { fromKobo, moneyOut, toKobo } from "../../lib/money.js";
import { SALVAGE_CATEGORY, lineNet } from "../../lib/settlement.js";
import { recomputeSettlement } from "./settlementStore.js";
import { zMoney, zRequiredText, zText } from "../../lib/validation.js";
import type { AuthUser } from "../../middleware/authenticate.js";
import { claimForStaffWrite, findScopedClaim } from "../claims/claims.service.js";

export const VALUATION_CATEGORIES = [
  "Building/Civil Works",
  "Plant & Machinery",
  "Stock & Contents",
  "Motor Parts",
  "Marine Cargo",
  "Labor",
  "Salvage Recovery",
  "Other",
] as const;

// Once the final report is with the principal, the figures are what is being signed off.
const LOCKED_AT = ["PENDING_SIGNOFF"] as const;

const itemBase = z.object({
  itemDescription: zRequiredText(500, "Describe the item."),
  category: z.enum(VALUATION_CATEGORIES, { message: "Pick a category." }),
  claimedAmount: zMoney,
  assessedAmount: zMoney,
  depreciationAmount: zMoney,
  bettermentDeduction: zMoney,
  adjusterNotes: zText(5000),
});
// Amounts default to zero only on a new line; an update changes only the fields sent.
const itemFields = itemBase.extend({
  claimedAmount: zMoney.default("0.00"),
  assessedAmount: zMoney.default("0.00"),
  depreciationAmount: zMoney.default("0.00"),
  bettermentDeduction: zMoney.default("0.00"),
});
export const itemInput = itemFields;
export const itemUpdate = itemBase.partial();
export const reorderInput = z.object({ ids: z.array(z.number().int().positive()).min(1) });

type ItemData = z.infer<typeof itemFields>;

/** Rejects deductions larger than the assessed amount, and deductions on a salvage line. */
function checkLine(d: ItemData) {
  if (d.category === SALVAGE_CATEGORY) {
    if (toKobo(d.depreciationAmount) !== 0n || toKobo(d.bettermentDeduction) !== 0n) {
      throw badRequest("A salvage line records the amount recovered only: leave depreciation and betterment at zero.");
    }
    return;
  }
  if (toKobo(d.depreciationAmount) + toKobo(d.bettermentDeduction) > toKobo(d.assessedAmount)) {
    throw badRequest("Depreciation and betterment together can't be more than the assessed amount.", [
      { path: "depreciationAmount", message: "Too large for the assessed amount." },
    ]);
  }
}

function itemOut(i: ValuationItem) {
  return {
    id: i.id,
    itemDescription: i.itemDescription,
    category: i.category,
    claimedAmount: moneyOut(i.claimedAmount)!,
    assessedAmount: moneyOut(i.assessedAmount)!,
    depreciationAmount: moneyOut(i.depreciationAmount)!,
    bettermentDeduction: moneyOut(i.bettermentDeduction)!,
    netPayable: moneyOut(i.netPayable)!,
    deductions: fromKobo(toKobo(String(i.depreciationAmount)) + toKobo(String(i.bettermentDeduction))),
    adjusterNotes: i.adjusterNotes,
    sortOrder: i.sortOrder,
  };
}

export async function getValuation(actor: AuthUser, claimId: number) {
  if (actor.role === "INSURER") throw forbidden();
  await findScopedClaim(actor, claimId);
  const { claim, items, settlement } = await prisma.$transaction((tx) => recomputeSettlement(tx, claimId));
  const editable = !["SETTLED", "REPUDIATED", ...LOCKED_AT].includes(claim.status);
  return {
    items: items.map(itemOut),
    settlement,
    totalDeductions: fromKobo(toKobo(settlement.totalDepreciation) + toKobo(settlement.totalBetterment)),
    basis: {
      sumInsured: moneyOut(claim.policy.sumInsured),
      valueAtRisk: moneyOut(claim.valueAtRisk),
      applyAverage: claim.applyAverage,
      excessAmount: moneyOut(claim.policy.excessAmount),
      excessPercentage: claim.policy.excessPercentage.toFixed(2),
    },
    editable,
    categories: VALUATION_CATEGORIES,
  };
}

const AUDIT_FIELDS = ["itemDescription", "category", "claimedAmount", "assessedAmount", "depreciationAmount", "bettermentDeduction", "adjusterNotes"] as const;

export async function addItem(actor: AuthUser, claimId: number, data: ItemData, ip: string | null) {
  checkLine(data);
  await prisma.$transaction(async (tx) => {
    await claimForStaffWrite(actor, claimId, tx, [...LOCKED_AT]);
    const last = await tx.valuationItem.aggregate({ where: { claimId }, _max: { sortOrder: true } });
    const item = await tx.valuationItem.create({
      data: { ...data, adjusterNotes: data.adjusterNotes ?? null, claimId, netPayable: fromKobo(lineNet(data)), sortOrder: (last._max.sortOrder ?? 0) + 1 },
    });
    const { settlement } = await recomputeSettlement(tx, claimId);
    await recordAudit({ action: "VALUATION_ITEM_ADDED", entityType: "ValuationItem", entityId: item.id, claimId, userId: actor.id, details: { item: itemOut(item), netRecommended: settlement.netRecommended }, ipAddress: ip }, tx);
  });
  return getValuation(actor, claimId);
}

async function itemOfClaim(tx: Tx, claimId: number, itemId: number) {
  const item = await tx.valuationItem.findFirst({ where: { id: itemId, claimId } });
  if (!item) throw notFound("Line");
  return item;
}

export async function updateItem(actor: AuthUser, claimId: number, itemId: number, data: z.infer<typeof itemUpdate>, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    await claimForStaffWrite(actor, claimId, tx, [...LOCKED_AT]);
    const before = await itemOfClaim(tx, claimId, itemId);
    const merged: ItemData = {
      itemDescription: data.itemDescription ?? before.itemDescription,
      category: (data.category ?? before.category) as ItemData["category"],
      claimedAmount: data.claimedAmount ?? String(before.claimedAmount),
      assessedAmount: data.assessedAmount ?? String(before.assessedAmount),
      depreciationAmount: data.depreciationAmount ?? String(before.depreciationAmount),
      bettermentDeduction: data.bettermentDeduction ?? String(before.bettermentDeduction),
      adjusterNotes: data.adjusterNotes !== undefined ? data.adjusterNotes : before.adjusterNotes,
    };
    checkLine(merged);
    const after = await tx.valuationItem.update({ where: { id: itemId }, data: { ...merged, netPayable: fromKobo(lineNet(merged)) } });
    const { settlement } = await recomputeSettlement(tx, claimId);
    const changes = diffRecords(before, after, [...AUDIT_FIELDS]);
    if (Object.keys(changes).length) {
      await recordAudit({ action: "VALUATION_ITEM_UPDATED", entityType: "ValuationItem", entityId: itemId, claimId, userId: actor.id, details: { changes, netRecommended: settlement.netRecommended }, ipAddress: ip }, tx);
    }
  });
  return getValuation(actor, claimId);
}

export async function deleteItem(actor: AuthUser, claimId: number, itemId: number, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    await claimForStaffWrite(actor, claimId, tx, [...LOCKED_AT]);
    const item = await itemOfClaim(tx, claimId, itemId);
    await tx.valuationItem.update({ where: { id: itemId }, data: { deletedAt: new Date() } });
    const { settlement } = await recomputeSettlement(tx, claimId);
    await recordAudit({ action: "VALUATION_ITEM_DELETED", entityType: "ValuationItem", entityId: itemId, claimId, userId: actor.id, details: { item: itemOut(item), netRecommended: settlement.netRecommended }, ipAddress: ip }, tx);
  });
  return getValuation(actor, claimId);
}

export async function reorderItems(actor: AuthUser, claimId: number, ids: number[]) {
  await prisma.$transaction(async (tx) => {
    await claimForStaffWrite(actor, claimId, tx, [...LOCKED_AT]);
    const current = await tx.valuationItem.findMany({ where: { claimId }, select: { id: true } });
    const known = new Set(current.map((c) => c.id));
    if (ids.length !== known.size || !ids.every((id) => known.has(id))) throw badRequest("Send every line of this schedule exactly once.");
    for (const [i, id] of ids.entries()) await tx.valuationItem.update({ where: { id }, data: { sortOrder: i + 1 } });
  });
  return getValuation(actor, claimId);
}
