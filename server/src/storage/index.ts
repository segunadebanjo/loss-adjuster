import { createHmac } from "node:crypto";
import { env } from "../config/env.js";
import { cloudinaryDriver } from "./cloudinary.js";
import { localDriver } from "./local.js";
import { s3Driver } from "./s3.js";
import type { StorageDriver, StorageName } from "./types.js";

export type { MediaKind, StorageDriver, StorageName } from "./types.js";

// Separate key for file links, derived so no extra secret is needed.
const fileSecret = createHmac("sha256", env.JWT_ACCESS_SECRET).update("local-file-urls").digest("hex");
export const local = localDriver({ dir: env.STORAGE_DIR, secret: fileSecret, publicPath: "/api/v1/files" });

let active: StorageDriver | null = null;

/** The driver new uploads go to (STORAGE_DRIVER). */
export function storage(): StorageDriver {
  if (active) return active;
  if (env.STORAGE_DRIVER === "cloudinary") {
    active = cloudinaryDriver({ cloudName: env.CLOUDINARY_CLOUD_NAME!, apiKey: env.CLOUDINARY_API_KEY!, apiSecret: env.CLOUDINARY_API_SECRET!, folder: env.STORAGE_FOLDER });
  } else if (env.STORAGE_DRIVER === "s3") {
    active = s3Driver({ bucket: env.S3_BUCKET!, region: env.AWS_REGION!, endpoint: env.S3_ENDPOINT || undefined, prefix: env.STORAGE_FOLDER });
  } else {
    active = local;
  }
  return active;
}

/** The driver a stored file was written with, so files keep working after STORAGE_DRIVER changes. */
export function driverFor(name: StorageName): StorageDriver {
  if (storage().name === name) return storage();
  if (name === "LOCAL") return local;
  throw new Error(`This file is in ${name} storage, which is not configured on this server.`);
}

/** Tests swap in a fake driver. */
export function setStorageForTests(driver: StorageDriver | null) {
  active = driver;
}
