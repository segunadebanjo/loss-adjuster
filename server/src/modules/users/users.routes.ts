import { Router } from "express";
import { requireRole } from "../../middleware/requireRole.js";
import * as c from "./users.controller.js";

export const userRoutes = Router();
userRoutes.use(requireRole("ADMIN"));
userRoutes.get("/", c.list);
userRoutes.post("/", c.create);
userRoutes.patch("/:id", c.update);
userRoutes.put("/:id/password", c.setPassword);
