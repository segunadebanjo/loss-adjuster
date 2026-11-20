import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import type { Role } from "@/shared/api/types";

export function FullPageSpinner() {
  return (
    <div className="grid min-h-dvh place-items-center text-slate-400">
      <Loader2 className="size-6 animate-spin" aria-label="Loading" />
    </div>
  );
}

/** Signed-in pages. The server enforces access; this only decides what to render. */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <FullPageSpinner />;
  if (status === "signedOut") return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
