import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { refreshSession, setAccessToken, setSessionLostHandler } from "@/shared/api/client";
import type { User } from "@/shared/api/types";
import { AuthContext, type AuthState } from "./AuthContext";
import { loginRequest, logoutRequest } from "./authApi";

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthState["status"]>("loading");
  const [user, setUser] = useState<User | null>(null);

  const clear = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setStatus("signedOut");
    queryClient.clear();
  }, [queryClient]);

  // On first load, the refresh cookie (if any) restores the session without asking for the password again.
  useEffect(() => {
    setSessionLostHandler(clear);
    let cancelled = false;
    refreshSession()
      .then((s) => {
        if (cancelled) return;
        setUser(s.user);
        setStatus("signedIn");
      })
      .catch(() => {
        if (!cancelled) setStatus("signedOut");
      });
    return () => {
      cancelled = true;
    };
  }, [clear]);

  const signIn = useCallback(async (email: string, password: string) => {
    const s = await loginRequest(email, password);
    setAccessToken(s.accessToken);
    setUser(s.user);
    setStatus("signedIn");
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      clear();
    }
  }, [clear]);

  const value = useMemo<AuthState>(() => ({ status, user, signIn, signOut }), [status, user, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
