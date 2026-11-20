import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileText } from "lucide-react";
import { errorMessage } from "@/shared/api/client";
import { documentKeys, documentsApi, openPdf } from "@/shared/api/documents";
import type { ClaimDetail } from "@/shared/api/types";
import { formatDateTime } from "@/shared/lib/claims";
import { Button, Card, EmptyState, ErrorNote, Spinner } from "@/shared/components/ui";
import { FeeNotesTab } from "./FeeNotesTab";

/** What an insurer or broker can download: signed-off reports and issued fee notes. */
export function InsurerDocumentsTab({ claim }: { claim: ClaimDetail }) {
  const { data, isPending, isError, error } = useQuery({ queryKey: documentKeys.reports(claim.id), queryFn: () => documentsApi.reports(claim.id) });
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      <Card title="Loss adjustment reports" bodyClassName="p-0">
        {isPending ? <Spinner /> : isError || !data ? <ErrorNote message={errorMessage(error)} className="m-4" /> : data.data.length === 0 ? (
          <EmptyState title="No signed-off reports yet">The preliminary report appears here once the principal adjuster signs it off.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <FileText className="size-5 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{r.type === "FINAL" ? "Final loss adjustment report" : "Preliminary report"}{r.version > 1 ? ` (version ${r.version})` : ""}</p>
                  <p className="text-xs text-slate-500">Signed off {formatDateTime(r.reviewedAt)}</p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => openPdf(documentsApi.reportPdfUrl(claim.id, r.id), `${r.type === "FINAL" ? "Final" : "Preliminary"} report ${claim.claimReference}.pdf`, "download").catch((e) => setErr(errorMessage(e)))}>
                  <Download className="size-3.5" /> Download PDF
                </Button>
              </li>
            ))}
          </ul>
        )}
        {err && <ErrorNote message={err} className="m-4" />}
      </Card>
      <div>
        <h2 className="mb-3 text-sm font-semibold">Fee notes</h2>
        <FeeNotesTab claim={claim} readOnly />
      </div>
    </div>
  );
}
