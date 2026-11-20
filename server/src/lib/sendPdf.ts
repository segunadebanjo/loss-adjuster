import type { Response } from "express";

/** Sends a PDF; `inline` opens it in the browser, otherwise it downloads. File names are made header-safe. */
export function sendPdf(res: Response, pdf: { data: Buffer; fileName: string }, inline: boolean) {
  const ascii = pdf.fileName.replace(/[^\w .-]+/g, "_");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(pdf.fileName)}`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(pdf.data);
}
