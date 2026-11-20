import { createHash } from "node:crypto";
import { z } from "zod";
import { fileTypeFromBuffer } from "file-type";
import type { EvidenceFile, EvidenceFileType, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { diffRecords, recordAudit } from "../../lib/audit.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { zText } from "../../lib/validation.js";
import { driverFor, storage, type MediaKind } from "../../storage/index.js";
import type { AuthUser } from "../../middleware/authenticate.js";
import { MAX_OTHER_BYTES, MAX_VIDEO_BYTES } from "../../middleware/upload.js";
import { claimForStaffWrite, findScopedClaim } from "../claims/claims.service.js";

export const EVIDENCE_CATEGORIES = [
  "Site Damage Photo",
  "Police Report",
  "Fire Service Report",
  "Waybill/Bill of Lading",
  "Repair Estimate/Proforma",
  "Invoice/Receipt",
  "Survey Report",
  "Claim Form",
  "Other",
] as const;
const INVOICE_CATEGORIES = new Set(["Repair Estimate/Proforma", "Invoice/Receipt"]);

/** What may be uploaded, decided from the file's own bytes (never its name or the browser's claim). */
const ALLOWED: Record<string, { kind: MediaKind; type: "image" | "video" | "doc" }> = {
  jpg: { kind: "image", type: "image" },
  png: { kind: "image", type: "image" },
  webp: { kind: "image", type: "image" },
  heic: { kind: "image", type: "image" },
  mp4: { kind: "video", type: "video" },
  mov: { kind: "video", type: "video" },
  webm: { kind: "video", type: "video" },
  "3gp": { kind: "video", type: "video" },
  pdf: { kind: "raw", type: "doc" },
  docx: { kind: "raw", type: "doc" },
  xlsx: { kind: "raw", type: "doc" },
};
export const ALLOWED_EXTENSIONS = Object.keys(ALLOWED);

const kindOf = (mime: string): MediaKind => (mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : "raw");

export const uploadFields = z.object({
  category: z.enum(EVIDENCE_CATEGORIES, { message: "Pick a category for these files." }),
  caption: zText(500),
  visibleToInsurer: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
});
export const evidenceUpdate = z.object({
  category: z.enum(EVIDENCE_CATEGORIES).optional(),
  caption: zText(500),
  visibleToInsurer: z.boolean().optional(),
});

export interface IncomingFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

/** Checks every file before anything is stored, so a batch is accepted or refused whole. */
async function inspect(files: IncomingFile[]) {
  if (!files.length) throw badRequest("Choose at least one file to upload.");
  const problems: Array<{ path: string; message: string }> = [];
  const checked = [];
  for (const f of files) {
    const detected = await fileTypeFromBuffer(f.buffer);
    const rule = detected ? ALLOWED[detected.ext] : undefined;
    if (!detected || !rule) {
      problems.push({ path: f.originalname, message: "Not an accepted file type (photos, videos, PDF, Word or Excel)." });
      continue;
    }
    const limit = rule.type === "video" ? MAX_VIDEO_BYTES : MAX_OTHER_BYTES;
    if (f.size > limit) {
      problems.push({ path: f.originalname, message: `Larger than ${limit / 1024 / 1024} MB.` });
      continue;
    }
    checked.push({ file: f, ext: detected.ext, mime: detected.mime, rule, sha256: createHash("sha256").update(f.buffer).digest("hex") });
  }
  if (problems.length) throw badRequest(problems.length === 1 ? `${problems[0]!.path}: ${problems[0]!.message}` : `${problems.length} files can't be uploaded.`, problems);
  return checked;
}

async function evidenceOut(e: EvidenceFile & { uploadedBy: { id: number; fullName: string } }) {
  const kind = kindOf(e.mimeType);
  let urls = { url: "", thumbnailUrl: null as string | null, downloadUrl: "" };
  try {
    urls = await driverFor(e.storageDriver).urls({ key: e.cloudPublicId, mime: e.mimeType, kind, fileName: e.fileName });
  } catch {
    // Storage no longer configured for this file; it is listed without links.
  }
  return {
    id: e.id,
    fileName: e.fileName,
    fileType: e.fileType,
    category: e.category,
    caption: e.caption,
    mimeType: e.mimeType,
    sizeBytes: e.sizeBytes,
    sha256: e.sha256,
    visibleToInsurer: e.visibleToInsurer,
    uploadedBy: e.uploadedBy,
    createdAt: e.createdAt.toISOString(),
    ...urls,
  };
}

const include = { uploadedBy: { select: { id: true, fullName: true } } } as const;

export async function listEvidence(actor: AuthUser, claimId: number, category?: string) {
  await findScopedClaim(actor, claimId);
  const where: Prisma.EvidenceFileWhereInput = {
    claimId,
    ...(category ? { category } : {}),
    // Insurers see only what the adjusters chose to share.
    ...(actor.role === "INSURER" ? { visibleToInsurer: true } : {}),
  };
  const rows = await prisma.evidenceFile.findMany({ where, include, orderBy: { createdAt: "desc" } });
  return Promise.all(rows.map(evidenceOut));
}

export async function uploadEvidence(actor: AuthUser, claimId: number, files: IncomingFile[], fields: z.infer<typeof uploadFields>, ip: string | null) {
  const claim = await claimForStaffWrite(actor, claimId);
  const checked = await inspect(files);
  const driver = storage();
  // Store first (outside the transaction: network calls), then record them all at once.
  const stored: Array<(typeof checked)[number] & { obj: { key: string; url: string } }> = [];
  for (const c of checked) {
    const obj = await driver.put(c.file.buffer, { folder: claim.claimReference, ext: c.ext, mime: c.mime, kind: c.rule.kind });
    stored.push({ ...c, obj });
  }
  const created = await prisma.$transaction(async (tx) => {
    await claimForStaffWrite(actor, claimId, tx);
    const rows = [];
    for (const s of stored) {
      const fileType: EvidenceFileType =
        s.rule.type === "image" ? "PHOTO" : s.rule.type === "video" ? "VIDEO" : INVOICE_CATEGORIES.has(fields.category) ? "INVOICE" : "DOCUMENT";
      const row = await tx.evidenceFile.create({
        data: {
          claimId,
          uploadedById: actor.id,
          fileName: s.file.originalname.slice(0, 255),
          storageDriver: driver.name,
          cloudPublicId: s.obj.key,
          fileUrl: s.obj.url,
          mimeType: s.mime,
          sizeBytes: s.file.size,
          sha256: s.sha256,
          fileType,
          category: fields.category,
          caption: fields.caption ?? null,
          visibleToInsurer: fields.visibleToInsurer,
        },
        include,
      });
      rows.push(row);
    }
    await recordAudit(
      { action: "EVIDENCE_UPLOADED", entityType: "EvidenceFile", claimId, userId: actor.id, details: { files: rows.map((r) => ({ id: r.id, fileName: r.fileName, sha256: r.sha256, category: r.category })) }, ipAddress: ip },
      tx,
    );
    return rows;
  });
  return Promise.all(created.map(evidenceOut));
}

const FIELDS = ["category", "caption", "visibleToInsurer"] as const;

export async function updateEvidence(actor: AuthUser, claimId: number, id: number, input: z.infer<typeof evidenceUpdate>, ip: string | null) {
  const row = await prisma.$transaction(async (tx) => {
    await claimForStaffWrite(actor, claimId, tx);
    const before = await tx.evidenceFile.findFirst({ where: { id, claimId } });
    if (!before) throw notFound("File");
    const after = await tx.evidenceFile.update({ where: { id }, data: input, include });
    const changes = diffRecords(before, after, [...FIELDS]);
    if (Object.keys(changes).length) await recordAudit({ action: "EVIDENCE_UPDATED", entityType: "EvidenceFile", entityId: id, claimId, userId: actor.id, details: { changes }, ipAddress: ip }, tx);
    return after;
  });
  return evidenceOut(row);
}

/** Hidden from the claim, never erased: the stored object stays (it is evidence). */
export async function deleteEvidence(actor: AuthUser, claimId: number, id: number, reason: string, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    await claimForStaffWrite(actor, claimId, tx);
    const row = await tx.evidenceFile.findFirst({ where: { id, claimId } });
    if (!row) throw notFound("File");
    await tx.evidenceFile.update({ where: { id }, data: { deletedAt: new Date() } });
    await recordAudit({ action: "EVIDENCE_REMOVED", entityType: "EvidenceFile", entityId: id, claimId, userId: actor.id, details: { fileName: row.fileName, sha256: row.sha256, reason }, ipAddress: ip }, tx);
  });
}
