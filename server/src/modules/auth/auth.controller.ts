import type { CookieOptions, Request, Response } from "express";
import { env } from "../../config/env.js";
import { currentUser } from "../../middleware/authenticate.js";
import { notFound } from "../../lib/errors.js";
import { verifyAccessToken } from "./tokens.js";
import { loginSchema } from "./auth.schema.js";
import * as auth from "./auth.service.js";

export const REFRESH_COOKIE = "la_refresh";
const COOKIE_PATH = "/api/v1/auth";

function cookieOptions(expires?: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: COOKIE_PATH,
    ...(expires ? { expires } : {}),
  };
}

function sendSession(res: Response, session: auth.Session) {
  res.cookie(REFRESH_COOKIE, session.refreshToken, cookieOptions(session.refreshExpiresAt));
  res.json({ accessToken: session.accessToken, user: session.user });
}

export async function login(req: Request, res: Response) {
  const { email, password } = loginSchema.parse(req.body);
  sendSession(res, await auth.login(email, password, req.ip ?? null));
}

export async function refresh(req: Request, res: Response) {
  try {
    sendSession(res, await auth.refresh(req.cookies?.[REFRESH_COOKIE], req.ip ?? null));
  } catch (err) {
    res.clearCookie(REFRESH_COOKIE, cookieOptions());
    throw err;
  }
}

export async function logout(req: Request, res: Response) {
  // Works with or without a valid access token, so an expired session can still sign out cleanly.
  const bearer = req.get("authorization")?.replace(/^Bearer /, "");
  const userId = bearer ? verifyAccessToken(bearer) : null;
  await auth.logout(req.cookies?.[REFRESH_COOKIE], userId, req.ip ?? null);
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
  res.status(204).end();
}

export async function me(req: Request, res: Response) {
  const user = await auth.getPublicUser(currentUser(req).id);
  if (!user) throw notFound("User");
  res.json({ user });
}
