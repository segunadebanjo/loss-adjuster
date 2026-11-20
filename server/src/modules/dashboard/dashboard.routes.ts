import { Router, type Request, type Response } from "express";
import { currentUser } from "../../middleware/authenticate.js";
import { listQuery } from "../claims/claims.schema.js";
import { dashboardKpis } from "./dashboard.service.js";

// The same filters as the claims list (page/sort ignored), scoped to the caller.
const filtersSchema = listQuery.omit({ page: true, pageSize: true, sort: true });

export const dashboardRoutes = Router();
dashboardRoutes.get("/kpis", async (req: Request, res: Response) => {
  res.json(await dashboardKpis(currentUser(req), filtersSchema.parse(req.query)));
});
