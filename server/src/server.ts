import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { prisma } from "./lib/prisma.js";

async function main() {
  await prisma.$connect().catch((err: unknown) => {
    console.error("Could not connect to MySQL. Check DATABASE_URL and that `docker compose up -d` is running.");
    throw err;
  });
  const server = createApp().listen(env.PORT, () => console.log(`API listening on http://localhost:${env.PORT}`));
  const stop = async () => {
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
