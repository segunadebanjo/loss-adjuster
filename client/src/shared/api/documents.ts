import { api } from "./client";
import type { ApprovalTier, AuditEntry, FeeNote, Report, ReportList, ReportType } from "./types";

const base = (claimId: number) => `/claims/${claimId}`;

/** Fetches a PDF with the session's token, then opens or downloads it. */
export async function openPdf(url: string, fileName: string, mode: "open" | "download") {
  // Open the tab during the click (browsers block pop-ups opened after an await), then point it at the file.
  const tab = mode === "open" ? window.open("about:blank", "_blank") : null;
  let res;
  try {
    res = await api.get<Blob>(url, { responseType: "blob" });
  } catch (err) {
    tab?.close();
    throw err;
  }
  const href = URL.createObjectURL(res.data);
  if (mode === "open") {
    if (tab) tab.location.href = href;
    else window.location.assign(href);
  } else {
    const a = document.createElement("a");
    a.href = href;
    a.download = fileName;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

export const documentsApi = {
  reports: (claimId: number) => api.get<ReportList>(`${base(claimId)}/reports`).then((r) => r.data),
  startReport: (claimId: number, type: ReportType) => api.post<{ data: Report }>(`${base(claimId)}/reports`, { type }).then((r) => r.data.data),
  saveReport: (claimId: number, id: number, sections: Record<string, string>) => api.patch<{ data: Report }>(`${base(claimId)}/reports/${id}`, { sections }).then((r) => r.data.data),
  submitReport: (claimId: number, id: number) => api.post<{ data: Report }>(`${base(claimId)}/reports/${id}/submit`).then((r) => r.data.data),
  approveReport: (claimId: number, id: number, note?: string) => api.post<{ data: Report }>(`${base(claimId)}/reports/${id}/approve`, { note }).then((r) => r.data.data),
  returnReport: (claimId: number, id: number, reason: string) => api.post<{ data: Report }>(`${base(claimId)}/reports/${id}/return`, { reason }).then((r) => r.data.data),
  reportPdfUrl: (claimId: number, id: number) => `${base(claimId)}/reports/${id}/pdf`,
  /** The latest report of a type: signed off once its approval tier is met, otherwise a DRAFT / PREVIEW. */
  reportPdfByTypeUrl: (claimId: number, type: ReportType) => `${base(claimId)}/reports/${type.toLowerCase()}/pdf`,

  feeNotes: (claimId: number) => api.get<{ data: FeeNote[]; rates: { vat: string; wht: string } }>(`${base(claimId)}/fee-notes`).then((r) => r.data),
  createFeeNote: (claimId: number, body: object) => api.post<{ data: FeeNote }>(`${base(claimId)}/fee-notes`, body).then((r) => r.data.data),
  updateFeeNote: (claimId: number, id: number, body: object) => api.patch<{ data: FeeNote }>(`${base(claimId)}/fee-notes/${id}`, body).then((r) => r.data.data),
  issueFeeNote: (claimId: number, id: number) => api.post<{ data: FeeNote }>(`${base(claimId)}/fee-notes/${id}/issue`).then((r) => r.data.data),
  markPaid: (claimId: number, id: number, body: { paidOn: string; reference: string }) => api.post<{ data: FeeNote }>(`${base(claimId)}/fee-notes/${id}/paid`, body).then((r) => r.data.data),
  cancelFeeNote: (claimId: number, id: number, reason: string) => api.post<{ data: FeeNote }>(`${base(claimId)}/fee-notes/${id}/cancel`, { reason }).then((r) => r.data.data),
  feeNotePdfUrl: (claimId: number, id: number) => `${base(claimId)}/fee-notes/${id}/pdf`,
  /** The claim's current fee note (latest issued, else the latest draft as a preview). */
  currentFeeNotePdfUrl: (claimId: number) => `${base(claimId)}/fee-note/pdf`,

  approvalTiers: () => api.get<{ data: ApprovalTier[] }>("/approval-tiers").then((r) => r.data.data),
  saveApprovalTiers: (tiers: ApprovalTier[]) => api.put<{ data: ApprovalTier[] }>("/approval-tiers", { tiers }).then((r) => r.data.data),

  audit: (claimId: number) => api.get<{ data: AuditEntry[] }>(`${base(claimId)}/audit`).then((r) => r.data.data),
  firm: () => api.get<{ name: string; placeholders: boolean }>("/meta/firm").then((r) => r.data),
};

export const documentKeys = {
  reports: (id: number) => ["claims", "detail", id, "reports"] as const,
  feeNotes: (id: number) => ["claims", "detail", id, "fee-notes"] as const,
  audit: (id: number) => ["claims", "detail", id, "audit"] as const,
  firm: ["firm"] as const,
  approvalTiers: ["approval-tiers"] as const,
};
