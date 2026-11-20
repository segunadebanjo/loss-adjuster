import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
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
import { evidenceRoutes } from "./modules/evidence/evidence.routes.js";
import { fileRoutes } from "./modules/evidence/files.routes.js";
import { inspectionRoutes } from "./modules/inspections/inspections.routes.js";
import { valuationRoutes } from "./modules/valuation/valuation.routes.js";
import { reportRoutes } from "./modules/reports/reports.routes.js";
import { feeNoteRoutes } from "./modules/fee-notes/feeNotes.routes.js";
import { auditRoutes } from "./modules/audit/audit.routes.js";
import { approvalTierRoutes } from "./modules/approval-tiers/approvalTiers.js";
import { feeNoteDocumentRoutes } from "./modules/fee-notes/feeNotes.routes.js";
import { firm } from "./lib/firm.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();
  if (env.NODE_ENV === "production") app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Evidence previews, thumbnails and videos come from Cloudinary or S3 signed links.
          "img-src": ["'self'", "data:", "blob:", "https:"],
          "media-src": ["'self'", "blob:", "https:"],
        },
      },
    }),
  );
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
  // Signed, expiring links for locally stored files (development); public by mount order.
  api.use("/files", fileRoutes);
  // Everything below needs a signed-in user.
  api.use(authenticate);
  api.use("/claims/:claimId/inspections", inspectionRoutes);
  api.use("/claims/:claimId/evidence", evidenceRoutes);
  api.use("/claims/:claimId/valuation", valuationRoutes);
  api.use("/claims/:claimId/reports", reportRoutes);
  api.use("/claims/:claimId/fee-notes", feeNoteRoutes);
  api.use("/claims/:claimId/fee-note", feeNoteDocumentRoutes);
  api.use("/claims/:claimId/audit", auditRoutes);
  api.get("/meta/firm", (_req, res) => {
    const f = firm();
    res.json({ name: f.name, placeholders: f.placeholders });
  });
  api.use("/claims", claimRoutes);
  api.use("/dashboard", dashboardRoutes);
  api.use("/policies", policyRoutes);
  api.use("/organisations", organisationRoutes);
  api.use("/users", userRoutes);
  api.use("/approval-tiers", approvalTierRoutes);
  app.use("/api/v1", api);

  // In production the API also serves the built web app (client/dist), so one web service runs both.
  const clientDist = path.resolve(process.cwd(), env.CLIENT_DIST);
  if (env.NODE_ENV === "production" && existsSync(path.join(clientDist, "index.html"))) {
    app.use(express.static(clientDist, { index: false, maxAge: "1h" }));
    app.get(/^\/(?!api\/|health$).*/, (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
