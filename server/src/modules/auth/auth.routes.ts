import { Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { authenticate } from "../../middleware/authenticate.js";
import * as controller from "./auth.controller.js";

// 5 failed sign-ins per 15 minutes per IP + email; successful ones don't count.
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? "")}|${String(req.body?.email ?? "").trim().toLowerCase()}`,
  handler: (_req, res) =>
    res.status(429).json({
      error: { code: "TOO_MANY_ATTEMPTS", message: "Too many failed sign-ins. Please wait 15 minutes and try again." },
    }),
});

export const authRoutes = Router();
authRoutes.post("/login", loginLimiter, controller.login);
authRoutes.post("/refresh", controller.refresh);
authRoutes.post("/logout", controller.logout);
authRoutes.get("/me", authenticate, controller.me);
