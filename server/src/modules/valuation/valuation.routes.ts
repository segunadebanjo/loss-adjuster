import { Router, type Request, type Response } from "express";
import { currentUser } from "../../middleware/authenticate.js";
import { requireRole } from "../../middleware/requireRole.js";
import { zId } from "../../lib/validation.js";
import * as svc from "./valuation.service.js";

// Mounted at /claims/:claimId/valuation (mergeParams). Staff only; scope and open-claim checks are in the service.
export const valuationRoutes = Router({ mergeParams: true });
valuationRoutes.use(requireRole("ADMIN", "ADJUSTER"));
const claimId = (req: Request) => zId.parse(req.params.claimId);

valuationRoutes.get("/", async (req: Request, res: Response) => {
  res.json(await svc.getValuation(currentUser(req), claimId(req)));
});
valuationRoutes.post("/items", async (req: Request, res: Response) => {
  res.status(201).json(await svc.addItem(currentUser(req), claimId(req), svc.itemInput.parse(req.body), req.ip ?? null));
});
valuationRoutes.patch("/items/:itemId", async (req: Request, res: Response) => {
  res.json(await svc.updateItem(currentUser(req), claimId(req), zId.parse(req.params.itemId), svc.itemUpdate.parse(req.body), req.ip ?? null));
});
valuationRoutes.delete("/items/:itemId", async (req: Request, res: Response) => {
  res.json(await svc.deleteItem(currentUser(req), claimId(req), zId.parse(req.params.itemId), req.ip ?? null));
});
valuationRoutes.put("/order", async (req: Request, res: Response) => {
  res.json(await svc.reorderItems(currentUser(req), claimId(req), svc.reorderInput.parse(req.body).ids));
});
