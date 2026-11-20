import { Router, type Request, type Response } from "express";
import { currentUser } from "../../middleware/authenticate.js";
import { requireRole } from "../../middleware/requireRole.js";
import { zId, zRequiredText } from "../../lib/validation.js";
import * as svc from "./inspections.service.js";

// Mounted at /claims/:claimId/inspections.
export const inspectionRoutes = Router({ mergeParams: true });
inspectionRoutes.use(requireRole("ADMIN", "ADJUSTER"));
const claimId = (req: Request) => zId.parse(req.params.claimId);

inspectionRoutes.get("/", async (req: Request, res: Response) => {
  res.json({ data: await svc.listInspections(currentUser(req), claimId(req)) });
});
inspectionRoutes.post("/", async (req: Request, res: Response) => {
  res.status(201).json({ data: await svc.scheduleInspection(currentUser(req), claimId(req), svc.scheduleInput.parse(req.body), req.ip ?? null) });
});
inspectionRoutes.patch("/:inspectionId", async (req: Request, res: Response) => {
  res.json({ data: await svc.updateInspection(currentUser(req), claimId(req), zId.parse(req.params.inspectionId), svc.findingsInput.parse(req.body), req.ip ?? null) });
});
inspectionRoutes.delete("/:inspectionId", async (req: Request, res: Response) => {
  const reason = zRequiredText(1000, "Say why the visit is cancelled.").parse(req.body?.reason);
  res.json({ data: await svc.cancelInspection(currentUser(req), claimId(req), zId.parse(req.params.inspectionId), reason, req.ip ?? null) });
});
