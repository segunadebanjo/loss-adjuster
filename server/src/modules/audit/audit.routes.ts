import { Router, type Request, type Response } from "express";
import { currentUser } from "../../middleware/authenticate.js";
import { requireRole } from "../../middleware/requireRole.js";
import { prisma } from "../../lib/prisma.js";
import { zId } from "../../lib/validation.js";
import { findScopedClaim } from "../claims/claims.service.js";

/** GET /claims/:claimId/audit: the claim's entries plus its policy's, newest first. Staff only. */
export const auditRoutes = Router({ mergeParams: true });
auditRoutes.get("/", requireRole("ADMIN", "ADJUSTER"), async (req: Request, res: Response) => {
  const claimId = zId.parse(req.params.claimId);
  const claim = await findScopedClaim(currentUser(req), claimId);
  const rows = await prisma.auditLog.findMany({
    where: { OR: [{ claimId }, { entityType: "Policy", entityId: claim.policyId }] },
    include: { user: { select: { id: true, fullName: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 1000,
  });
  res.json({
    data: rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      user: r.user,
      details: r.details,
      ipAddress: currentUser(req).role === "ADMIN" ? r.ipAddress : null,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});
