import { Router, type Request, type Response } from "express";
import { currentUser } from "../../middleware/authenticate.js";
import { requireRole } from "../../middleware/requireRole.js";
import { sendPdf } from "../../lib/sendPdf.js";
import { zId } from "../../lib/validation.js";
import * as svc from "./reports.service.js";

// Mounted at /claims/:claimId/reports. Insurers may list and download signed-off reports only (enforced in the service).
export const reportRoutes = Router({ mergeParams: true });
const ids = (req: Request) => ({ claimId: zId.parse(req.params.claimId), reportId: zId.parse(req.params.reportId) });

reportRoutes.get("/", async (req: Request, res: Response) => {
  res.json(await svc.listReports(currentUser(req), zId.parse(req.params.claimId)));
});
reportRoutes.post("/", requireRole("ADMIN", "ADJUSTER"), async (req: Request, res: Response) => {
  res.status(201).json({ data: await svc.createReport(currentUser(req), zId.parse(req.params.claimId), svc.createInput.parse(req.body).type, req.ip ?? null) });
});
reportRoutes.patch("/:reportId", requireRole("ADMIN", "ADJUSTER"), async (req: Request, res: Response) => {
  const { claimId, reportId } = ids(req);
  res.json({ data: await svc.updateReport(currentUser(req), claimId, reportId, svc.bodyInput.parse(req.body), req.ip ?? null) });
});
reportRoutes.post("/:reportId/submit", requireRole("ADMIN", "ADJUSTER"), async (req: Request, res: Response) => {
  const { claimId, reportId } = ids(req);
  res.json({ data: await svc.submitReport(currentUser(req), claimId, reportId, req.ip ?? null) });
});
reportRoutes.post("/:reportId/approve", requireRole("ADMIN"), async (req: Request, res: Response) => {
  const { claimId, reportId } = ids(req);
  res.json({ data: await svc.approveReport(currentUser(req), claimId, reportId, svc.approveInput.parse(req.body ?? {}).note, req.ip ?? null) });
});
reportRoutes.post("/:reportId/return", requireRole("ADMIN"), async (req: Request, res: Response) => {
  const { claimId, reportId } = ids(req);
  res.json({ data: await svc.returnReport(currentUser(req), claimId, reportId, svc.returnInput.parse(req.body).reason, req.ip ?? null) });
});
// /:reportId/pdf takes a report id, or a type ("preliminary" / "final") for the latest version of that report:
// the signed-off PDF once its approval tier is met, otherwise (staff only) a DRAFT / PREVIEW.
reportRoutes.get("/:reportId/pdf", async (req: Request, res: Response) => {
  const claimId = zId.parse(req.params.claimId);
  const key = String(req.params.reportId).toLowerCase();
  const user = currentUser(req);
  const pdf = key === "preliminary" || key === "final"
    ? await svc.reportPdfByType(user, claimId, key === "final" ? "FINAL" : "PRELIMINARY")
    : await svc.reportPdf(user, claimId, zId.parse(req.params.reportId));
  sendPdf(res, pdf, req.query.inline === "1");
});
