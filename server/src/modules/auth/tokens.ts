import { createHmac, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";

const ISSUER = "loss-adjuster";

/** Short-lived access token; carries only the user id (role etc. are re-read per request). */
export function signAccessToken(userId: number): string {
  return jwt.sign({}, env.JWT_ACCESS_SECRET, {
    subject: String(userId),
    issuer: ISSUER,
    expiresIn: env.ACCESS_TOKEN_TTL_MINUTES * 60,
    algorithm: "HS256",
  });
}

/** The user id in a valid access token, else null. */
export function verifyAccessToken(token: string): number | null {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: ISSUER, algorithms: ["HS256"] });
    const id = typeof payload === "object" ? Number(payload.sub) : NaN;
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

/** Opaque refresh token: random, and only its HMAC is stored, so a database leak can't be replayed. */
export function newRefreshToken(): { raw: string; hash: string; expiresAt: Date } {
  const raw = randomBytes(48).toString("base64url");
  return { raw, hash: hashRefreshToken(raw), expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000) };
}

export function hashRefreshToken(raw: string): string {
  return createHmac("sha256", env.JWT_REFRESH_SECRET).update(raw).digest("hex");
}
