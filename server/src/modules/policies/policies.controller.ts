import type { Request, Response } from "express";
import { z } from "zod";
import { currentUser } from "../../middleware/authenticate.js";
import { zId } from "../../lib/validation.js";
import * as svc from "./policies.service.js";

export async function list(req: Request, res: Response) {
  const q = z.object({ q: z.string().trim().max(100).optional(), insurerId: z.coerce.number().int().positive().optional() }).parse(req.query);
  res.json({ data: await svc.listPolicies({ q: q.q, insurerOrgId: q.insurerId }) });
}

export async function verify(req: Request, res: Response) {
  const { naicomUid } = z.object({ naicomUid: z.string().trim().min(1, "Enter the NAICOM policy UID.").max(64) }).parse(req.query);
  res.json(await svc.verifyPolicy(naicomUid));
}

export async function get(req: Request, res: Response) {
  res.json({ data: await svc.getPolicy(zId.parse(req.params.id)) });
}

export async function create(req: Request, res: Response) {
  res.status(201).json({ data: await svc.createPolicy(currentUser(req), svc.policyInput.parse(req.body), req.ip ?? null) });
}

export async function update(req: Request, res: Response) {
  const id = zId.parse(req.params.id);
  res.json({ data: await svc.updatePolicy(currentUser(req), id, svc.policyUpdate.parse(req.body), req.ip ?? null) });
}
