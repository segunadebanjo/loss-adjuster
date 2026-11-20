import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StorageDriver } from "./types.js";

const URL_TTL_MS = 3600_000;

/**
 * Development and tests only (refused in production by config/env.ts): files under STORAGE_DIR, served by
 * GET /api/v1/files/<key> with an expiring HMAC signature, so <img> tags work without a bearer token.
 */
export function localDriver(cfg: { dir: string; secret: string; publicPath: string }): StorageDriver & { verify: (key: string, exp: string, dl: string, sig: string) => boolean; root: string } {
  const root = path.resolve(cfg.dir);
  const sign = (key: string, exp: string, dl: string) => createHmac("sha256", cfg.secret).update(`file:${key}:${exp}:${dl}`).digest("base64url");
  const signed = (key: string, dl: boolean) => {
    const exp = String(Date.now() + URL_TTL_MS);
    const d = dl ? "1" : "0";
    return `${cfg.publicPath}/${key}?exp=${exp}&dl=${d}&sig=${sign(key, exp, d)}`;
  };
  return {
    name: "LOCAL",
    root,
    async put(body, opts) {
      const key = `${opts.folder}/${randomUUID()}.${opts.ext}`;
      const full = path.join(root, key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, body, { flag: "wx" });
      return { key, url: `local://${key}` };
    },
    async urls({ key, kind }) {
      return { url: signed(key, false), thumbnailUrl: kind === "image" ? signed(key, false) : null, downloadUrl: signed(key, true) };
    },
    verify(key, exp, dl, sig) {
      if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
      const expected = Buffer.from(sign(key, exp, dl));
      const given = Buffer.from(sig);
      return expected.length === given.length && timingSafeEqual(expected, given);
    },
  };
}
