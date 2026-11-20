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
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ.");
  }
  return env;
}

export const env = load();
export const corsOrigins = env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
