import type { AxiosProgressEvent } from "axios";
import { api } from "./client";
import type { EvidenceFile, Inspection, Valuation } from "./types";

const base = (claimId: number) => `/claims/${claimId}`;

export const workspaceApi = {
  inspections: (claimId: number) => api.get<{ data: Inspection[] }>(`${base(claimId)}/inspections`).then((r) => r.data.data),
  scheduleInspection: (claimId: number, body: object) => api.post<{ data: Inspection[] }>(`${base(claimId)}/inspections`, body).then((r) => r.data.data),
  updateInspection: (claimId: number, id: number, body: object) => api.patch<{ data: Inspection[] }>(`${base(claimId)}/inspections/${id}`, body).then((r) => r.data.data),
  cancelInspection: (claimId: number, id: number, reason: string) =>
    api.delete<{ data: Inspection[] }>(`${base(claimId)}/inspections/${id}`, { data: { reason } }).then((r) => r.data.data),

  evidence: (claimId: number) => api.get<{ data: EvidenceFile[]; categories: string[]; accepted: string[] }>(`${base(claimId)}/evidence`).then((r) => r.data),
  upload: (claimId: number, files: File[], fields: { category: string; caption: string; visibleToInsurer: boolean }, onProgress?: (fraction: number) => void) => {
    const form = new FormData();
    for (const f of files) form.append("files", f);
    form.append("category", fields.category);
    form.append("caption", fields.caption);
    form.append("visibleToInsurer", String(fields.visibleToInsurer));
    return api
      .post<{ data: EvidenceFile[] }>(`${base(claimId)}/evidence`, form, {
        // Let the browser set multipart with its boundary (the client's default is JSON).
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 10 * 60_000,
        onUploadProgress: (e: AxiosProgressEvent) => onProgress?.(e.total ? e.loaded / e.total : 0),
      })
      .then((r) => r.data.data);
  },
  updateEvidence: (claimId: number, id: number, body: object) => api.patch<{ data: EvidenceFile }>(`${base(claimId)}/evidence/${id}`, body).then((r) => r.data.data),
  deleteEvidence: (claimId: number, id: number, reason: string) => api.delete(`${base(claimId)}/evidence/${id}`, { data: { reason } }),

  valuation: (claimId: number) => api.get<Valuation>(`${base(claimId)}/valuation`).then((r) => r.data),
  addItem: (claimId: number, body: object) => api.post<Valuation>(`${base(claimId)}/valuation/items`, body).then((r) => r.data),
  updateItem: (claimId: number, id: number, body: object) => api.patch<Valuation>(`${base(claimId)}/valuation/items/${id}`, body).then((r) => r.data),
  deleteItem: (claimId: number, id: number) => api.delete<Valuation>(`${base(claimId)}/valuation/items/${id}`).then((r) => r.data),
  reorder: (claimId: number, ids: number[]) => api.put<Valuation>(`${base(claimId)}/valuation/order`, { ids }).then((r) => r.data),
};

export const workspaceKeys = {
  inspections: (id: number) => ["claims", "detail", id, "inspections"] as const,
  evidence: (id: number) => ["claims", "detail", id, "evidence"] as const,
  valuation: (id: number) => ["claims", "detail", id, "valuation"] as const,
};
