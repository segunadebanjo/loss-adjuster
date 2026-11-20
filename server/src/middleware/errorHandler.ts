import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import multer from "multer";
import { AppError } from "../lib/errors.js";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` } });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Some fields are missing or invalid.",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    });
    return;
  }
  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE" ? "A file is larger than 100 MB, the most allowed (videos)."
      : err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE" ? "Send up to 20 files at a time, in the \"files\" field."
      : `The upload was refused (${err.code}).`;
    res.status(400).json({ error: { code: "UPLOAD_REJECTED", message } });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    res.status(409).json({ error: { code: "CONFLICT", message: "A record with these details already exists." } });
    return;
  }
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({ error: { code: "BAD_JSON", message: "The request body is not valid JSON." } });
    return;
  }
  console.error(err);
  const message =
    process.env.NODE_ENV === "production" ? "Something went wrong." : err instanceof Error ? err.message : String(err);
  res.status(500).json({ error: { code: "INTERNAL", message } });
}
