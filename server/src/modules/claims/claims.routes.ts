import { Router } from "express";
import { requireRole } from "../../middleware/requireRole.js";
import * as c from "./claims.controller.js";

// Every handler scopes rows to the caller (lib/scope.ts); requireRole is the coarse gate on top.
export const claimRoutes = Router();
claimRoutes.get("/", c.list);
claimRoutes.get("/meta/options", c.options);
claimRoutes.get("/:id", c.get);
claimRoutes.post("/", requireRole("ADMIN"), c.create);
claimRoutes.patch("/:id", requireRole("ADMIN", "ADJUSTER"), c.update);
claimRoutes.post("/:id/assign", requireRole("ADMIN"), c.assign);
claimRoutes.post("/:id/transition", requireRole("ADMIN", "ADJUSTER"), c.transition);
claimRoutes.delete("/:id", requireRole("ADMIN"), c.remove);
