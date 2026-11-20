import path from "node:path";
import { Router, type Request, type Response } from "express";
import { local } from "../../storage/index.js";

/**
 * GET /api/v1/files/<key>?exp&dl&sig: files kept by the local driver (development). Public by mount order (before
 * authenticate) because <img> tags can't send a bearer token; the expiring signature is the access check.
 */
export const fileRoutes = Router();
fileRoutes.get("/*key", (req: Request, res: Response) => {
  const key = ([] as string[]).concat((req.params as Record<string, string | string[]>).key ?? []).join("/");
  const { exp = "", dl = "0", sig = "" } = req.query as Record<string, string>;
  if (!key || key.includes("..") || !local.verify(key, exp, dl, sig)) {
    res.status(403).json({ error: { code: "FORBIDDEN", message: "This file link has expired. Reload the page." } });
    return;
  }
  res.setHeader("Cache-Control", "private, max-age=600");
  res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'");
  if (dl === "1") res.attachment(path.basename(key));
  res.sendFile(key, { root: local.root, dotfiles: "deny" }, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: { code: "NOT_FOUND", message: "File not found." } });
  });
});
