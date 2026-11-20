import type { NextFunction, Request, Response } from "express";
import type { Role } from "@prisma/client";
import { verifyAccessToken } from "../modules/auth/tokens.js";
import { prisma } from "../lib/prisma.js";
import { unauthorized } from "../lib/errors.js";

export interface AuthUser {
  id: number;
  role: Role;
  organisationId: number | null;
  fullName: string;
  email: string;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

/**
 * Requires `Authorization: Bearer <access token>`. The token only identifies the user: role, active flag and
 * organisation are read from the database on every request, so a deactivation or role change applies at once.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) throw unauthorized();
  const userId = verifyAccessToken(token);
  if (userId == null) throw unauthorized("Your session has expired. Please sign in again.");
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, organisationId: true, fullName: true, email: true, isActive: true },
  });
  if (!user || !user.isActive) throw unauthorized();
  req.user = { id: user.id, role: user.role, organisationId: user.organisationId, fullName: user.fullName, email: user.email };
  next();
}

/** The signed-in user; only call after `authenticate`. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
