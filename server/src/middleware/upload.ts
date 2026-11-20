import multer from "multer";

export const MAX_FILES = 20;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_OTHER_BYTES = 15 * 1024 * 1024;

/**
 * Multipart uploads held in memory (field "files"), at most 20 per request. Multer only enforces the largest limit
 * (video); per-type limits and the real file type (magic bytes) are checked in the evidence service.
 */
export const uploadFiles = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_BYTES, files: MAX_FILES, fields: 20, fieldSize: 64 * 1024 },
}).array("files", MAX_FILES);
