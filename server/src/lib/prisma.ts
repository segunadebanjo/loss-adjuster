import { PrismaClient } from "@prisma/client";

// Models with a deleted_at column. Reads on them skip soft-deleted rows unless the query names deletedAt itself
// (e.g. `where: { deletedAt: { not: null } }` to list deleted rows). Nested includes are NOT filtered: add
// `where: { deletedAt: null }` to an include of one of these relations.
const SOFT_DELETE_MODELS = new Set([
  "Organisation",
  "User",
  "Policy",
  "Claim",
  "Inspection",
  "EvidenceFile",
  "ValuationItem",
]);
const READS = new Set(["findFirst", "findFirstOrThrow", "findMany", "findUnique", "findUniqueOrThrow", "count", "aggregate", "groupBy"]);

function createClient() {
  const base = new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });
  return base.$extends({
    name: "soft-delete",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (SOFT_DELETE_MODELS.has(model) && READS.has(operation)) {
            const a = (args ?? {}) as { where?: Record<string, unknown> };
            if (!a.where || !("deletedAt" in a.where)) a.where = { ...a.where, deletedAt: null };
            return query(a as typeof args);
          }
          return query(args);
        },
      },
    },
  });
}

export type Db = ReturnType<typeof createClient>;
export type Tx = Parameters<Parameters<Db["$transaction"]>[0]>[0];

const globalForPrisma = globalThis as unknown as { prisma?: Db };
export const prisma: Db = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
