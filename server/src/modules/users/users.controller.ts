import type { Request, Response } from "express";
import { z } from "zod";
import { currentUser } from "../../middleware/authenticate.js";
import { zId } from "../../lib/validation.js";
import * as svc from "./users.service.js";

const listQuery = z.object({
  role: z.enum(["ADMIN", "ADJUSTER", "INSURER"]).optional(),
  active: z.enum(["true", "false"]).optional().transform((v) => (v === undefined ? undefined : v === "true")),
  q: z.string().trim().max(100).optional(),
});

export async function list(req: Request, res: Response) {
  res.json({ data: await svc.listUsers(listQuery.parse(req.query)) });
}

export async function create(req: Request, res: Response) {
  res.status(201).json({ data: await svc.createUser(currentUser(req), svc.userCreate.parse(req.body), req.ip ?? null) });
}

export async function update(req: Request, res: Response) {
  const id = zId.parse(req.params.id);
  res.json({ data: await svc.updateUser(currentUser(req), id, svc.userUpdate.parse(req.body), req.ip ?? null) });
}

export async function setPassword(req: Request, res: Response) {
  const id = zId.parse(req.params.id);
  await svc.setPassword(currentUser(req), id, svc.passwordInput.parse(req.body).password, req.ip ?? null);
  res.status(204).end();
}
