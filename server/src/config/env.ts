import { z } from "zod";

// Every setting the server reads, validated once at start-up: a bad value stops the process with a message
// naming the variable, instead of failing later inside a request.
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4100),
  CORS_ORIGINS: z.string().default("http://localhost:5174"),
  DATABASE_URL: z.string().startsWith("mysql://", "DATABASE_URL must be a mysql:// URL"),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).max(120).default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
  /** The built web app, served by the API in production. Relative to the server folder. */
  CLIENT_DIST: z.string().default("../client/dist"),
  STORAGE_DRIVER: z.enum(["cloudinary", "s3", "local"]).default("local"),
  STORAGE_DIR: z.string().default("./storage"),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  STORAGE_FOLDER: z.string().default("loss-adjuster"),
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  // Printed on reports and fee notes. The defaults are placeholders: set the real values before issuing documents.
  FIRM_NAME: z.string().default("Pinnacle Loss Adjusters Ltd"),
  FIRM_ADDRESS: z.string().default("[Firm address], Lagos"),
  FIRM_RC_NUMBER: z.string().default("RC [000000]"),
  FIRM_NAICOM_LICENCE: z.string().default("NAICOM/LA/[0000]"),
  FIRM_EMAIL: z.string().default("claims@[firm-domain]"),
  FIRM_PHONE: z.string().default("+234 [000 000 0000]"),
  FIRM_TIN: z.string().default("[TIN]"),
  FIRM_VAT_NUMBER: z.string().default("[VAT registration no.]"),
  FIRM_BANK_NAME: z.string().default("[Bank name]"),
  FIRM_ACCOUNT_NAME: z.string().default("[Account name]"),
  FIRM_ACCOUNT_NUMBER: z.string().default("[0000000000]"),
  /** Path to a PNG or JPG logo, relative to the server folder. Optional. */
  FIRM_LOGO_PATH: z.string().default(""),
  /** Where the Handlebars PDF templates live, relative to the server folder. */
  TEMPLATES_DIR: z.string().default("src/templates"),
  /** html = the templates through headless Chrome (falls back to PDFKit while a template is missing); pdfkit = never Chrome. */
  PDF_RENDERER: z.enum(["html", "pdfkit"]).default("html"),
  /** Chrome to use instead of the one Puppeteer downloads (e.g. a system Chromium). */
  PUPPETEER_EXECUTABLE_PATH: z.string().default(""),
  VAT_RATE: z.coerce.number().min(0).max(100).default(7.5),
  WHT_RATE: z.coerce.number().min(0).max(100).default(10),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment settings:\n${lines.join("\n")}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === "production" && /change-me/.test(env.JWT_ACCESS_SECRET + env.JWT_REFRESH_SECRET)) {
    throw new Error("Set real JWT_ACCESS_SECRET and JWT_REFRESH_SECRET values in production.");
  }
  const blank = (v?: string) => !v || v.trim() === "";
  if (env.STORAGE_DRIVER === "cloudinary" && [env.CLOUDINARY_CLOUD_NAME, env.CLOUDINARY_API_KEY, env.CLOUDINARY_API_SECRET].some(blank)) {
    throw new Error("STORAGE_DRIVER=cloudinary needs CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.");
  }
  if (env.STORAGE_DRIVER === "s3" && [env.S3_BUCKET, env.AWS_REGION].some(blank)) {
    throw new Error("STORAGE_DRIVER=s3 needs S3_BUCKET and AWS_REGION (and credentials unless the host provides them).");
  }
  if (env.STORAGE_DRIVER === "local" && env.NODE_ENV === "production") {
    throw new Error("STORAGE_DRIVER=local is for development only. Use cloudinary or s3 in production.");
  }
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ.");
  }
  return env;
}

export const env = load();
export const corsOrigins = env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
