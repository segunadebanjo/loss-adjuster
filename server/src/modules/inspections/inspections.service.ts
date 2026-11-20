import { z } from "zod";
import type { Inspection } from "@prisma/client";
import { prisma, type Tx } from "../../lib/prisma.js";
import { diffRecords, recordAudit } from "../../lib/audit.js";
import { badRequest, forbidden, notFound, unprocessable } from "../../lib/errors.js";
import { zText } from "../../lib/validation.js";
import type { AuthUser } from "../../middleware/authenticate.js";
import { claimForStaffWrite, findScopedClaim, moveClaimStatus } from "../claims/claims.service.js";

const zTimestamp = z.iso.datetime({ offset: true, message: "Enter a date and time." }).transform((s) => new Date(s));
const zLat = z.coerce.number().min(-90, "Latitude is between -90 and 90.").max(90, "Latitude is between -90 and 90.");
const zLng = z.coerce.number().min(-180, "Longitude is between -180 and 180.").max(180, "Longitude is between -180 and 180.");

export const scheduleInput = z.object({
  scheduledDate: zTimestamp,
  adjusterId: z.coerce.number().int().positive().optional(),
  siteNotes: zText(10_000),
});

export const findingsInput = z
  .object({
    scheduledDate: zTimestamp.optional(),
    adjusterId: z.coerce.number().int().positive().optional(),
    completedDate: zTimestamp.nullable().optional(),
    gpsLatitude: zLat.nullable().optional(),
    gpsLongitude: zLng.nullable().optional(),
    siteNotes: zText(10_000),
    causeOfLossVerified: z.boolean().optional(),
    policyLiabilityConfirmed: z.boolean().optional(),
    thirdPartyInvolvement: z.boolean().optional(),
  })
  .refine((v) => (v.gpsLatitude == null) === (v.gpsLongitude == null), { message: "Enter both latitude and longitude, or neither.", path: ["gpsLongitude"] });

/** Roughly Nigeria's bounding box, to flag a mistyped coordinate (not enforced). */
const inNigeria = (lat: number, lng: number) => lat >= 4 && lat <= 14 && lng >= 2.6 && lng <= 14.7;

function inspectionOut(i: Inspection & { adjuster: { id: number; fullName: string } }) {
  const lat = i.gpsLatitude == null ? null : Number(i.gpsLatitude);
  const lng = i.gpsLongitude == null ? null : Number(i.gpsLongitude);
  return {
    id: i.id,
    adjuster: i.adjuster,
    scheduledDate: i.scheduledDate.toISOString(),
    completedDate: i.completedDate?.toISOString() ?? null,
    gpsLatitude: lat,
    gpsLongitude: lng,
    gpsOutsideNigeria: lat != null && lng != null ? !inNigeria(lat, lng) : false,
    siteNotes: i.siteNotes,
    causeOfLossVerified: i.causeOfLossVerified,
    policyLiabilityConfirmed: i.policyLiabilityConfirmed,
    thirdPartyInvolvement: i.thirdPartyInvolvement,
    createdAt: i.createdAt.toISOString(),
  };
}

const include = { adjuster: { select: { id: true, fullName: true } } } as const;

export async function listInspections(actor: AuthUser, claimId: number) {
  if (actor.role === "INSURER") throw forbidden();
  await findScopedClaim(actor, claimId);
  const rows = await prisma.inspection.findMany({ where: { claimId }, include, orderBy: { scheduledDate: "asc" } });
  return rows.map(inspectionOut);
}

/** The inspector: the claim's adjuster by default; only the principal may send someone else. */
async function pickAdjuster(tx: Tx, actor: AuthUser, assigned: number | null, requested?: number) {
  const id = requested ?? assigned ?? (actor.role === "ADJUSTER" ? actor.id : undefined);
  if (!id) throw unprocessable("Assign a loss adjuster to the claim first.");
  if (id !== assigned && actor.role !== "ADMIN") throw forbidden("Only the principal adjuster can send another adjuster.");
  const u = await tx.user.findUnique({ where: { id }, select: { role: true, isActive: true } });
  if (!u || u.role !== "ADJUSTER" || !u.isActive) throw badRequest("Pick an active loss adjuster.");
  return id;
}

function checkCompleted(completed: Date | null | undefined) {
  if (completed && completed.getTime() > Date.now() + 5 * 60_000) throw badRequest("The inspection can't be completed in the future.", [{ path: "completedDate", message: "This is in the future." }]);
}

export async function scheduleInspection(actor: AuthUser, claimId: number, input: z.infer<typeof scheduleInput>, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    const claim = await claimForStaffWrite(actor, claimId, tx);
    const adjusterId = await pickAdjuster(tx, actor, claim.assignedAdjusterId, input.adjusterId);
    const ins = await tx.inspection.create({ data: { claimId, adjusterId, scheduledDate: input.scheduledDate, siteNotes: input.siteNotes ?? null } });
    await recordAudit({ action: "INSPECTION_SCHEDULED", entityType: "Inspection", entityId: ins.id, claimId, userId: actor.id, details: { scheduledDate: ins.scheduledDate.toISOString(), adjusterId }, ipAddress: ip }, tx);
    // The first inspection moves a new instruction on.
    if (claim.status === "NEW_INSTRUCTION") await moveClaimStatus(tx, actor, claimId, "INSPECTION_SCHEDULED", { ipAddress: ip });
  });
  return listInspections(actor, claimId);
}

const FIELDS = ["scheduledDate", "adjusterId", "completedDate", "gpsLatitude", "gpsLongitude", "siteNotes", "causeOfLossVerified", "policyLiabilityConfirmed", "thirdPartyInvolvement"] as const;

export async function updateInspection(actor: AuthUser, claimId: number, inspectionId: number, input: z.infer<typeof findingsInput>, ip: string | null) {
  checkCompleted(input.completedDate);
  await prisma.$transaction(async (tx) => {
    const claim = await claimForStaffWrite(actor, claimId, tx);
    const before = await tx.inspection.findFirst({ where: { id: inspectionId, claimId } });
    if (!before) throw notFound("Inspection");
    const adjusterId = input.adjusterId !== undefined && input.adjusterId !== before.adjusterId
      ? await pickAdjuster(tx, actor, claim.assignedAdjusterId, input.adjusterId)
      : undefined;
    const after = await tx.inspection.update({
      where: { id: inspectionId },
      data: {
        ...input,
        adjusterId,
        gpsLatitude: input.gpsLatitude === undefined ? undefined : input.gpsLatitude?.toFixed(6) ?? null,
        gpsLongitude: input.gpsLongitude === undefined ? undefined : input.gpsLongitude?.toFixed(6) ?? null,
      },
    });
    const changes = diffRecords(before, after, [...FIELDS]);
    if (Object.keys(changes).length) {
      await recordAudit({ action: after.completedDate && !before.completedDate ? "INSPECTION_COMPLETED" : "INSPECTION_UPDATED", entityType: "Inspection", entityId: inspectionId, claimId, userId: actor.id, details: { changes }, ipAddress: ip }, tx);
    }
    // Recording the site visit starts the investigation.
    if (after.completedDate && !before.completedDate && claim.status === "INSPECTION_SCHEDULED") {
      await moveClaimStatus(tx, actor, claimId, "UNDER_INVESTIGATION", { ipAddress: ip });
    }
  });
  return listInspections(actor, claimId);
}

/** Cancel a visit that hasn't happened; a completed inspection is evidence and stays. */
export async function cancelInspection(actor: AuthUser, claimId: number, inspectionId: number, reason: string, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    await claimForStaffWrite(actor, claimId, tx);
    const ins = await tx.inspection.findFirst({ where: { id: inspectionId, claimId } });
    if (!ins) throw notFound("Inspection");
    if (ins.completedDate) throw unprocessable("A completed inspection can't be removed.");
    await tx.inspection.update({ where: { id: inspectionId }, data: { deletedAt: new Date() } });
    await recordAudit({ action: "INSPECTION_CANCELLED", entityType: "Inspection", entityId: inspectionId, claimId, userId: actor.id, details: { reason, scheduledDate: ins.scheduledDate.toISOString() }, ipAddress: ip }, tx);
  });
  return listInspections(actor, claimId);
}
