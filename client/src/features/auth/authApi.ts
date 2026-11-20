import { api } from "@/shared/api/client";
import type { User } from "@/shared/api/types";

export async function loginRequest(email: string, password: string) {
  const res = await api.post<{ accessToken: string; user: User }>("/auth/login", { email, password });
  return res.data;
}

export async function logoutRequest() {
  await api.post("/auth/logout");
}
