import PDFDocument from "pdfkit";
import type { Firm } from "../lib/firm.js";

// The PDF builders take plain data and return bytes: no database, no clock (the date is passed in).
// Money is printed as "NGN 1,250,000.00": the built-in PDF fonts have no naira sign.

export type Doc = PDFKit.PDFDocument;
export const BRAND = "#0f5132";
export const INK = "#1e293b";
export const MUTED = "#64748b";
export const RULE = "#cbd5e1";
export const MARGIN = 50;

export function money(v: string | null | undefined): string {
  if (v == null || v === "") return "-";
  const neg = v.startsWith("-");
  const [whole = "0", frac = "00"] = v.replace("-", "").split(".");
  return `${neg ? "-" : ""}NGN ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac.padEnd(2, "0").slice(0, 2)}`;
}

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" });
export const longDate = (d: Date | string) => dateFmt.format(typeof d === "string" ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d) : d);

export function newDoc(title: string, meta: { author: string; subject: string; createdAt: Date }): Doc {
  return new PDFDocument({
    size: "A4",
    margins: { top: MARGIN, bottom: 60, left: MARGIN, right: MARGIN },
    bufferPages: true,
    info: { Title: title, Author: meta.author, Subject: meta.subject, CreationDate: meta.createdAt, ModDate: meta.createdAt, Producer: "Loss Adjuster Claims" },
  });
}

export const contentWidth = (doc: Doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right;

/** Letterhead: logo (if any), firm name and details, a rule. */
export function letterhead(doc: Doc, f: Firm) {
  const top = doc.y;
  let textX = MARGIN;
  if (f.logoPath) {
    try {
      doc.image(f.logoPath, MARGIN, top, { fit: [64, 64] });
      textX = MARGIN + 76;
    } catch {
      // Unreadable logo: carry on without it.
    }
  }
  doc.fillColor(BRAND).font("Helvetica-Bold").fontSize(16).text(f.name, textX, top, { width: contentWidth(doc) - (textX - MARGIN) });
  doc.fillColor(MUTED).font("Helvetica").fontSize(8.5)
    .text(`Loss Adjusters & Surveyors · ${f.naicomLicence} · ${f.rcNumber}`, textX)
    .text(f.address, textX)
    .text(`${f.phone} · ${f.email}`, textX);
  const bottom = Math.max(doc.y, top + (f.logoPath ? 64 : 0)) + 8;
  doc.moveTo(MARGIN, bottom).lineTo(doc.page.width - MARGIN, bottom).lineWidth(1.5).strokeColor(BRAND).stroke();
  doc.x = MARGIN;
  doc.y = bottom + 14;
  doc.fillColor(INK);
}

export function title(doc: Doc, text: string, sub?: string) {
  doc.font("Helvetica-Bold").fontSize(15).fillColor(INK).text(text, MARGIN, doc.y, { width: contentWidth(doc) });
  if (sub) doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text(sub);
  doc.moveDown(0.8).fillColor(INK);
}

export function heading(doc: Doc, text: string) {
  ensureSpace(doc, 60);
  doc.moveDown(0.6).font("Helvetica-Bold").fontSize(11).fillColor(BRAND).text(text.toUpperCase(), MARGIN, doc.y, { width: contentWidth(doc), characterSpacing: 0.3 });
  doc.moveDown(0.3).fillColor(INK);
}

export function paragraph(doc: Doc, text: string) {
  doc.font("Helvetica").fontSize(10).fillColor(INK).text(text.trim() || "-", MARGIN, doc.y, { width: contentWidth(doc), lineGap: 2 });
  doc.moveDown(0.4);
}

export function ensureSpace(doc: Doc, needed: number) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

/** Two-column label/value block. */
export function keyValues(doc: Doc, rows: Array<[string, string | null | undefined]>, labelWidth = 150) {
  const w = contentWidth(doc);
  for (const [label, value] of rows) {
    const v = value == null || value === "" ? "-" : value;
    doc.font("Helvetica").fontSize(9.5);
    const h = Math.max(doc.heightOfString(label, { width: labelWidth - 8 }), doc.heightOfString(v, { width: w - labelWidth }));
    ensureSpace(doc, h + 6);
    const y = doc.y;
    doc.fillColor(MUTED).text(label, MARGIN, y, { width: labelWidth - 8 });
    doc.fillColor(INK).text(v, MARGIN + labelWidth, y, { width: w - labelWidth });
    doc.y = y + h + 4;
  }
  doc.x = MARGIN;
  doc.moveDown(0.3);
}

export interface Column {
  header: string;
  width: number; // fraction of the content width
  align?: "left" | "right";
}

/** Simple ruled table; repeats the header on a new page. */
export function table(doc: Doc, columns: Column[], rows: string[][], opts: { boldLastRow?: boolean; fontSize?: number } = {}) {
  const w = contentWidth(doc);
  const size = opts.fontSize ?? 9;
  const xs: number[] = [];
  let x = MARGIN;
  for (const c of columns) {
    xs.push(x);
    x += c.width * w;
  }
  const drawRow = (cells: string[], bold: boolean, header = false) => {
    doc.font(bold || header ? "Helvetica-Bold" : "Helvetica").fontSize(size);
    const heights = cells.map((cell, i) => doc.heightOfString(cell, { width: columns[i]!.width * w - 8 }));
    const h = Math.max(...heights) + 8;
    if (doc.y + h > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      if (!header) drawRow(columns.map((c) => c.header), false, true);
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
    }
    const y = doc.y;
    if (header) doc.rect(MARGIN, y, w, h).fill("#f1f5f9");
    doc.fillColor(header ? MUTED : INK);
    cells.forEach((cell, i) => doc.text(cell, xs[i]! + 4, y + 4, { width: columns[i]!.width * w - 8, align: columns[i]!.align ?? "left" }));
    doc.moveTo(MARGIN, y + h).lineTo(MARGIN + w, y + h).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.y = y + h;
  };
  drawRow(columns.map((c) => c.header), false, true);
  rows.forEach((r, i) => drawRow(r, !!opts.boldLastRow && i === rows.length - 1));
  doc.x = MARGIN;
  doc.moveDown(0.6);
}

/** Page numbers, a footer line and (for previews) a DRAFT watermark on every page. */
export function finish(doc: Doc, footer: string, watermark?: string) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    if (watermark) {
      doc.save();
      doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
      doc.font("Helvetica-Bold").fontSize(90).fillColor("#dc2626").opacity(0.12)
        .text(watermark, 0, doc.page.height / 2 - 50, { width: doc.page.width, align: "center", lineBreak: false });
      doc.restore();
      doc.opacity(1);
    }
    const bottom = doc.page.height - 40;
    // Writing inside the bottom margin would start a new page, so lift the margin while drawing the footer.
    const oldBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED)
      .text(footer, MARGIN, bottom, { width: contentWidth(doc) - 80, lineBreak: false })
      .text(`Page ${i - range.start + 1} of ${range.count}`, doc.page.width - MARGIN - 80, bottom, { width: 80, align: "right", lineBreak: false });
    doc.page.margins.bottom = oldBottom;
  }
}

export function toBuffer(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}
