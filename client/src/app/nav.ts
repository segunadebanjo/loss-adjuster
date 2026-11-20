import { ClipboardList, FilePlus2, LayoutDashboard, Users, type LucideIcon } from "lucide-react";
import type { Role } from "@/shared/api/types";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
  /** Label override per role. */
  labelFor?: Partial<Record<Role, string>>;
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["ADMIN", "ADJUSTER", "INSURER"], labelFor: { INSURER: "Overview" } },
  { to: "/claims", label: "Claims", icon: ClipboardList, roles: ["ADMIN", "ADJUSTER", "INSURER"], labelFor: { ADJUSTER: "My claims" } },
  { to: "/intake", label: "New instruction", icon: FilePlus2, roles: ["ADMIN"] },
  { to: "/users", label: "Users & adjusters", icon: Users, roles: ["ADMIN"] },
];

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Principal Adjuster",
  ADJUSTER: "Loss Adjuster",
  INSURER: "Insurer / Broker",
};
