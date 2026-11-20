import axios, { AxiosError, type AxiosRequestConfig } from "axios";
import type { ApiErrorBody, User } from "./types";

// The one HTTP client. The access token lives in memory only (never localStorage); the refresh token is an
// httpOnly cookie the browser sends to /api/v1/auth. A 401 triggers one refresh (shared by every request that
// failed at the same moment) and a retry; if the refresh fails the app shows the sign-in page.

let accessToken: string | null = null;
let onSessionLost: (() => void) | null = null;
let refreshing: Promise<{ accessToken: string; user: User }> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function setSessionLostHandler(fn: () => void) {
  onSessionLost = fn;
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api/v1",
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.set("Authorization", `Bearer ${accessToken}`);
  return config;
});

/** Single-flight refresh: concurrent callers share one request, so the rotated token isn't spent twice. */
export function refreshSession() {
  refreshing ??= api
    .post<{ accessToken: string; user: User }>("/auth/refresh", undefined, { _noRetry: true } as AxiosRequestConfig)
    .then((res) => {
      setAccessToken(res.data.accessToken);
      return res.data;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

api.interceptors.response.use(undefined, async (error: AxiosError) => {
  const config = error.config as (AxiosRequestConfig & { _retried?: boolean; _noRetry?: boolean }) | undefined;
  const isAuthCall = config?.url?.startsWith("/auth/");
  if (error.response?.status === 401 && config && !config._retried && !config._noRetry && !isAuthCall) {
    config._retried = true;
    try {
      await refreshSession();
      return api(config);
    } catch {
      setAccessToken(null);
      onSessionLost?.();
    }
  }
  throw error;
});

/** A readable message from any API error. */
export function errorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data as ApiErrorBody | undefined;
    if (body?.error?.message) return body.error.message;
    if (!err.response) return "Can't reach the server. Check your connection.";
  }
  return fallback;
}
