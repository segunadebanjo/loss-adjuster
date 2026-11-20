import type { Request, Response } from "express";
import { currentUser } from "../../middleware/authenticate.js";
import { zId } from "../../lib/validation.js";
import * as svc from "./claims.service.js";
import { assignInput, claimUpdate, deleteInput, intakeInput, listQuery, transitionInput } from "./claims.schema.js";

export async function list(req: Request, res: Response) {
  res.json(await svc.listClaims(currentUser(req), listQuery.parse(req.query)));
}

export async function options(req: Request, res: Response) {
  res.json(await svc.claimOptions(currentUser(req)));
}

export async function get(req: Request, res: Response) {
  res.json({ data: await svc.getClaim(currentUser(req), zId.parse(req.params.id)) });
}

export async function create(req: Request, res: Response) {
  res.status(201).json({ data: await svc.intake(currentUser(req), intakeInput.parse(req.body), req.ip ?? null) });
}

export async function update(req: Request, res: Response) {
  const id = zId.parse(req.params.id);
  res.json({ data: await svc.updateClaim(currentUser(req), id, claimUpdate.parse(req.body), req.ip ?? null) });
}

export async function assign(req: Request, res: Response) {
  const id = zId.parse(req.params.id);
  const { adjusterId } = assignInput.parse(req.body);
  res.json({ data: await svc.assignAdjuster(currentUser(req), id, adjusterId, req.ip ?? null) });
}

export async function transition(req: Request, res: Response) {
  const id = zId.parse(req.params.id);
  const { to, reason, settledAmount } = transitionInput.parse(req.body);
  res.json({ data: await svc.transition(currentUser(req), id, to, { reason, settledAmount, ipAddress: req.ip ?? null }) });
}

export async function remove(req: Request, res: Response) {
  const id = zId.parse(req.params.id);
  await svc.deleteClaim(currentUser(req), id, deleteInput.parse(req.body).reason, req.ip ?? null);
  res.status(204).end();
}
