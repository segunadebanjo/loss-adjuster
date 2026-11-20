/**
 * PdfGeneratorService: fills the Handlebars HTML templates in TEMPLATES_DIR with a report or fee note and prints them
 * to A4 with headless Chrome (Puppeteer). A template that isn't there yet falls back to the PDFKit builder, so the app
 * keeps producing documents. Unapproved documents get a DRAFT / PREVIEW watermark.
 *
 * The page is locked down: JavaScript off and every request that isn't a data: URI refused, so a template or a value
 * typed into a report can never make the server fetch anything.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Browser } from "puppeteer";
import { env } from "../config/env.js";
import { buildFeeNotePdf, type FeeNotePdfModel } from "./feeNotePdf.js";
import { buildReportPdf, type ReportPdfModel } from "./reportPdf.js";
import { createHandlebars } from "./handlebars.js";
import { feeNoteView, reportView } from "./views.js";

export const TEMPLATE_FILES = { report: "loss-adjustment-report.template.html", feeNote: "fee-note.template.html" } as const;
type TemplateKey = keyof typeof TEMPLATE_FILES;

const hb = createHandlebars();
const compiled = new Map<string, { mtimeMs: number; render: HandlebarsTemplateDelegate }>();

export function templatePath(key: TemplateKey) {
  return path.resolve(process.cwd(), env.TEMPLATES_DIR, TEMPLATE_FILES[key]);
}

/** The compiled template, recompiled when the file changes; null when it isn't there. */
function template(key: TemplateKey): HandlebarsTemplateDelegate | null {
  const file = templatePath(key);
  if (!existsSync(file)) return null;
  const { mtimeMs } = statSync(file);
  const hit = compiled.get(file);
  if (hit && hit.mtimeMs === mtimeMs) return hit.render;
  const source = readFileSync(file, "utf8");
  hb.precompile(source); // throws now on a syntax error (compile() would only throw on first use)
  const render = hb.compile(source, { strict: false });
  compiled.set(file, { mtimeMs, render });
  return render;
}

const WATERMARK = (text: string) => `<style>
  .pdf-watermark { position: fixed; top: 42%; left: 0; right: 0; text-align: center; transform: rotate(-30deg);
    font: 700 64pt Arial, sans-serif; color: rgba(185, 28, 28, 0.13); letter-spacing: 6px; z-index: 9999; pointer-events: none; }
</style><div class="pdf-watermark">${text}</div>`;

/** Fills the template and adds the watermark just before </body> (or at the end). */
export function renderHtml(render: HandlebarsTemplateDelegate, view: object, watermark: string | null) {
  const html = render(view);
  if (!watermark) return html;
  const mark = WATERMARK(watermark);
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${mark}</body>`) : html + mark;
}

// One Chrome for the process, started on first use and closed after a minute idle (it costs ~150-200 MB).
let browser: Promise<Browser> | null = null;
let idle: NodeJS.Timeout | null = null;
let active = 0;

async function getBrowser() {
  if (!browser) {
    const { default: puppeteer } = await import("puppeteer");
    browser = puppeteer
      .launch({
        headless: "shell",
        executablePath: env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-zygote", "--font-render-hinting=none"],
      })
      .catch((err: unknown) => {
        browser = null;
        throw err;
      });
  }
  return browser;
}

function scheduleClose() {
  if (idle) clearTimeout(idle);
  idle = setTimeout(() => void closePdfBrowser(), 60_000);
  idle.unref();
}

export async function closePdfBrowser() {
  if (idle) clearTimeout(idle);
  idle = null;
  const b = browser;
  browser = null;
  if (b) await (await b).close().catch(() => undefined);
}

/** HTML -> A4 PDF. */
export async function htmlToPdf(html: string): Promise<Buffer> {
  active++;
  try {
    const page = await (await getBrowser()).newPage();
    try {
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on("request", (req) => (req.url().startsWith("data:") || req.url() === "about:blank" ? req.continue() : req.abort()));
      await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
      await page.emulateMediaType("print");
      const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, timeout: 60_000 });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
    }
  } finally {
    active--;
    if (active === 0) scheduleClose();
  }
}

/** Which renderer a document will use, for the health of the set-up (and tests). */
export function rendererFor(key: TemplateKey): "html" | "pdfkit" {
  return env.PDF_RENDERER === "html" && template(key) ? "html" : "pdfkit";
}

/**
 * A broken template (it doesn't compile or fill) or a Chrome failure must never block a sign-off or an issue: it is
 * logged loudly and the PDFKit layout is used instead.
 */
async function viaTemplate(key: TemplateKey, html: (render: HandlebarsTemplateDelegate) => string, fallback: () => Promise<Buffer>) {
  if (env.PDF_RENDERER !== "html") return fallback();
  let render: HandlebarsTemplateDelegate | null;
  try {
    render = template(key);
    if (!render) return fallback();
    return await htmlToPdf(html(render));
  } catch (err) {
    console.error(`PDF TEMPLATE FAILED (${TEMPLATE_FILES[key]}), using the built-in layout: ${err instanceof Error ? err.message : String(err)}`);
    return fallback();
  }
}

export async function renderReportPdf(m: ReportPdfModel): Promise<Buffer> {
  return viaTemplate("report", (render) => renderHtml(render, reportView(m), m.approved ? null : "DRAFT / PREVIEW"), () => buildReportPdf(m));
}

export async function renderFeeNotePdf(m: FeeNotePdfModel): Promise<Buffer> {
  const mark = m.status === "DRAFT" ? "DRAFT / PREVIEW" : m.status === "CANCELLED" ? "CANCELLED" : null;
  return viaTemplate("feeNote", (render) => renderHtml(render, feeNoteView(m), mark), () => buildFeeNotePdf(m));
}
