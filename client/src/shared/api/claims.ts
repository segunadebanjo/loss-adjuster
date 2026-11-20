import { api } from "./client";
import type { ClaimDetail, ClaimListItem, ClaimOptions, ClaimStatus, DashboardKpis, Paged, Policy } from "./types";

export type ClaimQuery = Record<string, string | undefined>;
const clean = (q: ClaimQuery) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== ""));

export const claimsApi = {
  list: (q: ClaimQuery) => api.get<Paged<ClaimListItem>>("/claims", { params: clean(q) }).then((r) => r.data),
  get: (id: number) => api.get<{ data: ClaimDetail }>(`/claims/${id}`).then((r) => r.data.data),
  options: () => api.get<ClaimOptions>("/claims/meta/options").then((r) => r.data),
  kpis: (q: ClaimQuery) => api.get<DashboardKpis>("/dashboard/kpis", { params: clean(q) }).then((r) => r.data),
  create: (body: object) => api.post<{ data: ClaimDetail }>("/claims", body).then((r) => r.data.data),
  update: (id: number, body: object) => api.patch<{ data: ClaimDetail }>(`/claims/${id}`, body).then((r) => r.data.data),
  assign: (id: number, adjusterId: number | null) => api.post<{ data: ClaimDetail }>(`/claims/${id}/assign`, { adjusterId }).then((r) => r.data.data),
  transition: (id: number, body: { to: ClaimStatus; reason?: string; settledAmount?: string }) =>
    api.post<{ data: ClaimDetail }>(`/claims/${id}/transition`, body).then((r) => r.data.data),
  remove: (id: number, reason: string) => api.delete(`/claims/${id}`, { data: { reason } }),
  verifyPolicy: (naicomUid: string) =>
    api
      .get<{ found: false } | { found: true; policy: Policy; claims: Array<{ id: number; claimReference: string; dateOfLoss: string; status: ClaimStatus }> }>("/policies/verify", { params: { naicomUid } })
      .then((r) => r.data),
};

export const queryKeys = {
  claims: ["claims"] as const,
  claim: (id: number) => ["claims", "detail", id] as const,
  options: ["claims", "options"] as const,
  kpis: ["dashboard"] as const,
  users: ["users"] as const,
  organisations: ["organisations"] as const,
};
