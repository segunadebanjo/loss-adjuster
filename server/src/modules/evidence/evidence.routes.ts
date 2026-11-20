import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { currentUser } from "../../middleware/authenticate.js";
import { requireRole } from "../../middleware/requireRole.js";
import { uploadFiles } from "../../middleware/upload.js";
import { zId, zRequiredText } from "../../lib/validation.js";
import * as svc from "./evidence.service.js";

// Mounted at /claims/:claimId/evidence. Insurers may list (shared files only); only staff change anything.
export const evidenceRoutes = Router({ mergeParams: true });
const claimId = (req: Request) => zId.parse(req.params.claimId);

evidenceRoutes.get("/", async (req: Request, res: Response) => {
  const { category } = z.object({ category: z.string().max(64).optional() }).parse(req.query);
  res.json({ data: await svc.listEvidence(currentUser(req), claimId(req), category), categories: svc.EVIDENCE_CATEGORIES, accepted: svc.ALLOWED_EXTENSIONS });
});
evidenceRoutes.post("/", requireRole("ADMIN", "ADJUSTER"), uploadFiles, async (req: Request, res: Response) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  res.status(201).json({ data: await svc.uploadEvidence(currentUser(req), claimId(req), files, svc.uploadFields.parse(req.body ?? {}), req.ip ?? null) });
});
evidenceRoutes.patch("/:fileId", requireRole("ADMIN", "ADJUSTER"), async (req: Request, res: Response) => {
  res.json({ data: await svc.updateEvidence(currentUser(req), claimId(req), zId.parse(req.params.fileId), svc.evidenceUpdate.parse(req.body), req.ip ?? null) });
});
evidenceRoutes.delete("/:fileId", requireRole("ADMIN", "ADJUSTER"), async (req: Request, res: Response) => {
  const reason = zRequiredText(1000, "Say why this file is being removed.").parse(req.body?.reason);
  await svc.deleteEvidence(currentUser(req), claimId(req), zId.parse(req.params.fileId), reason, req.ip ?? null);
  res.status(204).end();
});
