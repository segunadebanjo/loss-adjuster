import { Router, type Request, type Response } from "express";
import { currentUser } from "../../middleware/authenticate.js";
import { requireRole } from "../../middleware/requireRole.js";
import { sendPdf } from "../../lib/sendPdf.js";
import { zId } from "../../lib/validation.js";
import * as svc from "./feeNotes.service.js";

// Mounted at /claims/:claimId/fee-notes. Only the principal raises and changes fee notes; adjusters read;
// insurers see issued and paid ones.
export const feeNoteRoutes = Router({ mergeParams: true });
const ids = (req: Request) => ({ claimId: zId.parse(req.params.claimId), id: zId.parse(req.params.feeNoteId) });

feeNoteRoutes.get("/", async (req: Request, res: Response) => {
  res.json(await svc.listFeeNotes(currentUser(req), zId.parse(req.params.claimId)));
});
feeNoteRoutes.post("/", requireRole("ADMIN"), async (req: Request, res: Response) => {
  res.status(201).json({ data: await svc.createFeeNote(currentUser(req), zId.parse(req.params.claimId), svc.feeNoteInput.parse(req.body), req.ip ?? null) });
});
feeNoteRoutes.patch("/:feeNoteId", requireRole("ADMIN"), async (req: Request, res: Response) => {
  const { claimId, id } = ids(req);
  res.json({ data: await svc.updateFeeNote(currentUser(req), claimId, id, svc.feeNoteUpdate.parse(req.body), req.ip ?? null) });
});
feeNoteRoutes.post("/:feeNoteId/issue", requireRole("ADMIN"), async (req: Request, res: Response) => {
  const { claimId, id } = ids(req);
  res.json({ data: await svc.issueFeeNote(currentUser(req), claimId, id, req.ip ?? null) });
});
feeNoteRoutes.post("/:feeNoteId/paid", requireRole("ADMIN"), async (req: Request, res: Response) => {
  const { claimId, id } = ids(req);
  res.json({ data: await svc.markPaid(currentUser(req), claimId, id, svc.paidInput.parse(req.body), req.ip ?? null) });
});
feeNoteRoutes.post("/:feeNoteId/cancel", requireRole("ADMIN"), async (req: Request, res: Response) => {
  const { claimId, id } = ids(req);
  res.json({ data: await svc.cancelFeeNote(currentUser(req), claimId, id, svc.cancelInput.parse(req.body).reason, req.ip ?? null) });
});
feeNoteRoutes.get("/:feeNoteId/pdf", async (req: Request, res: Response) => {
  const { claimId, id } = ids(req);
  sendPdf(res, await svc.feeNotePdf(currentUser(req), claimId, id), req.query.inline === "1");
});

// Mounted at /claims/:claimId/fee-note: the claim's current fee note as a PDF (see currentFeeNotePdf).
export const feeNoteDocumentRoutes = Router({ mergeParams: true });
feeNoteDocumentRoutes.get("/pdf", async (req: Request, res: Response) => {
  const feeNoteId = req.query.feeNoteId ? zId.parse(req.query.feeNoteId) : undefined;
  sendPdf(res, await svc.currentFeeNotePdf(currentUser(req), zId.parse(req.params.claimId), feeNoteId), req.query.inline === "1");
});
