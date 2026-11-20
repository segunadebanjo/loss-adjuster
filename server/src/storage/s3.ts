import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageDriver } from "./types.js";

const URL_TTL_SECONDS = 3600;

/** A private S3 (or S3-compatible) bucket; every view is a presigned GET valid for an hour. No previews. */
export function s3Driver(cfg: { bucket: string; region: string; endpoint?: string; prefix: string }): StorageDriver {
  const client = new S3Client({ region: cfg.region, ...(cfg.endpoint ? { endpoint: cfg.endpoint, forcePathStyle: true } : {}) });
  return {
    name: "S3",
    async put(body, opts) {
      const key = `${cfg.prefix}/${opts.folder}/${randomUUID()}.${opts.ext}`;
      await client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: opts.mime, ServerSideEncryption: "AES256" }));
      return { key, url: `s3://${cfg.bucket}/${key}` };
    },
    async urls({ key, mime, kind, fileName }) {
      const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: cfg.bucket, Key: key, ResponseContentType: mime }), { expiresIn: URL_TTL_SECONDS });
      const downloadUrl = await getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: cfg.bucket, Key: key, ResponseContentDisposition: `attachment; filename="${fileName.replace(/["\\\r\n]/g, "_")}"` }),
        { expiresIn: URL_TTL_SECONDS },
      );
      return { url, thumbnailUrl: kind === "image" ? url : null, downloadUrl };
    },
  };
}
