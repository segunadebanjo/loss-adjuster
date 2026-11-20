import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import type { StorageDriver } from "./types.js";

/**
 * Cloudinary, uploaded as type "authenticated": the original is unchanged (it is evidence) and is only reachable
 * through signed URLs this server makes. Previews are delivery transformations (resized, q_auto, f_auto), so
 * compression never touches the stored original.
 */
export function cloudinaryDriver(cfg: { cloudName: string; apiKey: string; apiSecret: string; folder: string }): StorageDriver {
  cloudinary.config({ cloud_name: cfg.cloudName, api_key: cfg.apiKey, api_secret: cfg.apiSecret, secure: true });
  const deliveryType = "authenticated" as const;
  return {
    name: "CLOUDINARY",
    async put(body, opts) {
      const res = await new Promise<UploadApiResponse>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: `${cfg.folder}/${opts.folder}`,
            resource_type: opts.kind,
            type: deliveryType,
            unique_filename: true,
            use_filename: false,
            overwrite: false,
            // Raw files keep their extension in the public_id so downloads open correctly.
            ...(opts.kind === "raw" ? { format: opts.ext } : {}),
          },
          (err, result) => (err || !result ? reject(err ?? new Error("Cloudinary returned no result")) : resolve(result)),
        );
        stream.end(body);
      });
      return { key: res.public_id, url: res.secure_url };
    },
    async urls({ key, kind, fileName }) {
      const base = { resource_type: kind, type: deliveryType, sign_url: true, secure: true };
      const url = cloudinary.url(key, base);
      let thumbnailUrl: string | null = null;
      if (kind === "image") {
        thumbnailUrl = cloudinary.url(key, { ...base, transformation: [{ width: 480, height: 360, crop: "fill", gravity: "auto", quality: "auto", fetch_format: "auto" }] });
      } else if (kind === "video") {
        thumbnailUrl = cloudinary.url(key, { ...base, format: "jpg", transformation: [{ start_offset: "1", width: 480, height: 360, crop: "fill", quality: "auto" }] });
      }
      const stem = fileName.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "_").slice(0, 80) || "evidence";
      const downloadUrl = kind === "raw" ? url : cloudinary.url(key, { ...base, flags: `attachment:${stem}` });
      return { url, thumbnailUrl, downloadUrl };
    },
  };
}
