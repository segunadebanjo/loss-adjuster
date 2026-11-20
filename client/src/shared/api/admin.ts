import { api } from "./client";
import type { AdminUser, Organisation } from "./types";

export const adminApi = {
  users: () => api.get<{ data: AdminUser[] }>("/users").then((r) => r.data.data),
  createUser: (body: object) => api.post<{ data: AdminUser }>("/users", body).then((r) => r.data.data),
  updateUser: (id: number, body: object) => api.patch<{ data: AdminUser }>(`/users/${id}`, body).then((r) => r.data.data),
  setPassword: (id: number, password: string) => api.put(`/users/${id}/password`, { password }),
  organisations: () => api.get<{ data: Organisation[] }>("/organisations").then((r) => r.data.data),
  createOrganisation: (body: object) => api.post<{ data: Organisation }>("/organisations", body).then((r) => r.data.data),
  updateOrganisation: (id: number, body: object) => api.patch<{ data: Organisation }>(`/organisations/${id}`, body).then((r) => r.data.data),
};
