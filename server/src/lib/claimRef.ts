import type { Tx } from "./prisma.js";

/**
 * Next claim reference for the year, e.g. LA-2026-0001. Must run inside a transaction: the upsert row-locks the
 * year's counter until commit, so two intakes can never take the same number (and a rolled-back intake gives its
 * number back).
 */
export async function allocateClaimReference(tx: Tx, year: number): Promise<string> {
  await tx.$executeRaw`INSERT INTO claim_sequences (year, last_no) VALUES (${year}, 1)
    ON DUPLICATE KEY UPDATE last_no = last_no + 1`;
  const row = await tx.claimSequence.findUniqueOrThrow({ where: { year } });
  return `LA-${year}-${String(row.lastNo).padStart(4, "0")}`;
}
