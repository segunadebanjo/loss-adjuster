import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "./prisma.js";

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: number | null;
  claimId?: number | null;
  userId?: number | null;
  details?: Prisma.InputJsonValue;
  ipAddress?: string | null;
}

/** Append an audit entry. Pass the transaction client so the entry commits (or rolls back) with the change. */
export async function recordAudit(entry: AuditEntry, tx: Tx | typeof prisma = prisma): Promise<void> {
  await tx.auditLog.create({
    data: {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      claimId: entry.claimId ?? null,
      userId: entry.userId ?? null,
      details: entry.details,
      ipAddress: entry.ipAddress ?? null,
    },
  });
}

type Plain = string | number | boolean | null;
function norm(v: unknown): Plain {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && "toFixed" in (v as object)) return String(v); // Prisma Decimal
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  return JSON.stringify(v);
}

/** { field: { from, to } } for the listed fields that changed. Secrets never belong in `fields`. */
export function diffRecords<T extends Record<string, unknown>>(
  before: T,
  after: T,
  fields: Array<keyof T & string>,
): Record<string, { from: Plain; to: Plain }> {
  const out: Record<string, { from: Plain; to: Plain }> = {};
  for (const f of fields) {
    const a = norm(before[f]);
    const b = norm(after[f]);
    if (a !== b && !(a != null && b != null && Number(a) === Number(b) && typeof a !== "boolean")) out[f] = { from: a, to: b };
  }
  return out;
}
