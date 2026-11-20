import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma, type Tx } from "../../lib/prisma.js";
import { recordAudit } from "../../lib/audit.js";
import { matrixProblem, type Tier } from "../../lib/approvalMatrix.js";
import { unprocessable } from "../../lib/errors.js";
import { moneyOut } from "../../lib/money.js";
import { zMoney, zRequiredText } from "../../lib/validation.js";
import { currentUser } from "../../middleware/authenticate.js";
import { requireRole } from "../../middleware/requireRole.js";

const tierInput = z.object({
  label: zRequiredText(100, "Name the tier."),
  minAmount: zMoney,
  requiredApprovals: z.coerce.number().int().min(1, "At least one sign-off.").max(5, "At most five sign-offs."),
});
export const matrixInput = z.object({ tiers: z.array(tierInput).min(1).max(10) });

export async function loadTiers(tx: Tx | typeof prisma = prisma): Promise<Tier[]> {
  const rows = await tx.approvalTier.findMany({ orderBy: { minAmount: "asc" } });
  return rows.map((t) => ({ label: t.label, minAmount: moneyOut(t.minAmount)!, requiredApprovals: t.requiredApprovals }));
}

/** Replaces the whole matrix. Reports already submitted keep the sign-offs they were given at submission. */
export async function saveTiers(actorId: number, tiers: Tier[], ip: string | null) {
  const problem = matrixProblem(tiers);
  if (problem) throw unprocessable(problem);
  return prisma.$transaction(async (tx) => {
    const before = await loadTiers(tx);
    await tx.approvalTier.deleteMany();
    await tx.approvalTier.createMany({ data: tiers.map((t) => ({ label: t.label, minAmount: t.minAmount, requiredApprovals: t.requiredApprovals })) });
    const after = await loadTiers(tx);
    await recordAudit({ action: "APPROVAL_MATRIX_CHANGED", entityType: "ApprovalTier", userId: actorId, details: { from: before, to: after } as never, ipAddress: ip }, tx);
    return after;
  });
}

// Staff read it (the reports tab says how many sign-offs a report needs); only a principal changes it.
export const approvalTierRoutes = Router();
approvalTierRoutes.get("/", requireRole("ADMIN", "ADJUSTER"), async (_req: Request, res: Response) => {
  res.json({ data: await loadTiers() });
});
approvalTierRoutes.put("/", requireRole("ADMIN"), async (req: Request, res: Response) => {
  const { tiers } = matrixInput.parse(req.body);
  res.json({ data: await saveTiers(currentUser(req).id, tiers, req.ip ?? null) });
});
