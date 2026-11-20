import { createBrowserRouter, Navigate } from "react-router";
import { LoginPage } from "@/features/auth/LoginPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { ClaimsListPage } from "@/features/claims/ClaimsListPage";
import { ClaimDetailPage } from "@/features/claims/ClaimDetailPage";
import { IntakePage } from "@/features/intake/IntakePage";
import { UsersPage } from "@/features/users/UsersPage";
import { AppShell } from "./AppShell";
import { RequireAuth, RequireRole } from "./guards";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: "claims", element: <ClaimsListPage /> },
          { path: "claims/:id", element: <ClaimDetailPage /> },
          { path: "intake", element: <RequireRole roles={["ADMIN"]}><IntakePage /></RequireRole> },
          { path: "users", element: <RequireRole roles={["ADMIN"]}><UsersPage /></RequireRole> },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
