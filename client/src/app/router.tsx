import { createBrowserRouter, Navigate } from "react-router";
import { LoginPage } from "@/features/auth/LoginPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { ComingSoon } from "@/shared/components/ComingSoon";
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
          {
            path: "claims",
            element: <ComingSoon title="Claims" phase={2}>The claims pipeline with filters by status, adjuster, line, insurer and date.</ComingSoon>,
          },
          {
            path: "intake",
            element: (
              <RequireRole roles={["ADMIN"]}>
                <ComingSoon title="New instruction" phase={2}>Log an insurer's instruction, verify the policy by NAICOM UID and assign an adjuster.</ComingSoon>
              </RequireRole>
            ),
          },
          {
            path: "users",
            element: (
              <RequireRole roles={["ADMIN"]}>
                <ComingSoon title="Users & adjusters" phase={2}>Invite adjusters and insurer users, record NAICOM licences and CII qualifications.</ComingSoon>
              </RequireRole>
            ),
          },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
