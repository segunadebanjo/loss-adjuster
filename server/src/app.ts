import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { corsOrigins, env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { authenticate } from "./middleware/authenticate.js";
import { claimRoutes } from "./modules/claims/claims.routes.js";
import { dashboardRoutes } from "./modules/dashboard/dashboard.routes.js";
import { organisationRoutes } from "./modules/organisations/organisations.routes.js";
import { policyRoutes } from "./modules/policies/policies.routes.js";
import { userRoutes } from "./modules/users/users.routes.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();
  if (env.NODE_ENV === "production") app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: corsOrigins, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  if (env.NODE_ENV === "development") app.use(morgan("dev"));

  app.get("/health", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ok", database: "up" });
    } catch {
      res.status(503).json({ status: "degraded", database: "down" });
    }
  });

  const api = express.Router();
  api.use("/auth", authRoutes);
  // Everything below needs a signed-in user.
  api.use(authenticate);
  api.use("/claims", claimRoutes);
  api.use("/dashboard", dashboardRoutes);
  api.use("/policies", policyRoutes);
  api.use("/organisations", organisationRoutes);
  api.use("/users", userRoutes);
  app.use("/api/v1", api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
