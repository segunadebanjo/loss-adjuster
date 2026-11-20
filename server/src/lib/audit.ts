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
