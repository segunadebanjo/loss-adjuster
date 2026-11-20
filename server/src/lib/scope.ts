import type { Prisma } from "@prisma/client";
import type { AuthUser } from "../middleware/authenticate.js";

/**
 * The claims a user may see, as a Prisma `where`. Every claim query (list, detail, sub-resources) must AND this in;
 * a claim outside it is answered 404, the same as a missing one.
 *   ADMIN    -> every claim
 *   ADJUSTER -> claims assigned to them
 *   INSURER  -> claims on policies where their organisation is the insurer or the broker
 */
export function claimScope(user: AuthUser): Prisma.ClaimWhereInput {
  switch (user.role) {
    case "ADMIN":
      return {};
    case "ADJUSTER":
      return { assignedAdjusterId: user.id };
    case "INSURER":
      if (user.organisationId == null) return { id: -1 }; // matches nothing
      return {
        policy: { OR: [{ insurerOrgId: user.organisationId }, { brokerOrgId: user.organisationId }] },
      };
  }
}
