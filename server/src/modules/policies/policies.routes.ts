import { Router } from "express";
import { requireRole } from "../../middleware/requireRole.js";
import * as c from "./policies.controller.js";

export const policyRoutes = Router();
policyRoutes.use(requireRole("ADMIN"));
policyRoutes.get("/", c.list);
policyRoutes.get("/verify", c.verify);
policyRoutes.get("/:id", c.get);
policyRoutes.post("/", c.create);
policyRoutes.patch("/:id", c.update);
