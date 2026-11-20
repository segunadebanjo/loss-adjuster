import type { Request, Response } from "express";
import { z } from "zod";
import { currentUser } from "../../middleware/authenticate.js";
import { zId } from "../../lib/validation.js";
import * as svc from "./organisations.service.js";

export async function list(req: Request, res: Response) {
  const { type } = z.object({ type: z.enum(["INSURER", "BROKER"]).optional() }).parse(req.query);
  res.json({ data: await svc.listOrganisations(type) });
}

export async function create(req: Request, res: Response) {
  const org = await svc.createOrganisation(currentUser(req), svc.organisationInput.parse(req.body), req.ip ?? null);
  res.status(201).json({ data: org });
}

export async function update(req: Request, res: Response) {
  const id = zId.parse(req.params.id);
  res.json({ data: await svc.updateOrganisation(currentUser(req), id, svc.organisationUpdate.parse(req.body), req.ip ?? null) });
}
