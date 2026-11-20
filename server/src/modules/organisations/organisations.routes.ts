import { Router } from "express";
import { requireRole } from "../../middleware/requireRole.js";
import * as c from "./organisations.controller.js";

export const organisationRoutes = Router();
organisationRoutes.use(requireRole("ADMIN"));
organisationRoutes.get("/", c.list);
organisationRoutes.post("/", c.create);
organisationRoutes.patch("/:id", c.update);
