import { execSync } from "node:child_process";
import { createConnection } from "node:net";

// Creates a throwaway database (la_test_<timestamp>) on the TEST_DATABASE_URL server, applies the migrations,
// and drops it afterwards. Test files inherit DATABASE_URL pointing at it.
function baseUrl(): URL {
  const raw = process.env.TEST_DATABASE_URL ?? "mysql://la:la@localhost:3306/la_test";
  return new URL(raw);
}

async function reachable(url: URL): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: url.hostname, port: Number(url.port || 3306) });
    socket.once("connect", () => (socket.end(), resolve(true)));
    socket.once("error", () => resolve(false));
  });
}

export default async function setup() {
  const url = baseUrl();
  if (!(await reachable(url))) {
    throw new Error(`MySQL is not reachable at ${url.host}. Start it with \`docker compose up -d\` in loss-adjuster/.`);
  }
  url.pathname = `/la_test_${Date.now()}`;
  const dbUrl = url.toString();
  process.env.DATABASE_URL = dbUrl;
  // `migrate deploy` creates the database when it is missing.
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: dbUrl }, stdio: "pipe" });

  return async () => {
    const { PrismaClient } = await import("@prisma/client");
    const client = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    await client.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${url.pathname.slice(1)}\``);
    await client.$disconnect();
  };
}
