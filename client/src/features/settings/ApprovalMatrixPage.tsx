import { useState } from "react";
import type { ApprovalTier } from "@/shared/api/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { errorMessage } from "@/shared/api/client";
import { documentKeys, documentsApi } from "@/shared/api/documents";
import { moneyToApi, moneyToInput } from "@/shared/lib/claims";
import { PageHeader } from "@/shared/components/PageHeader";
import { Button, Card, ErrorNote, Input, MoneyInput, Spinner } from "@/shared/components/ui";

type Row = { label: string; minAmount: string; requiredApprovals: string };

/** The approval matrix: how many principal adjusters must sign off a final report, by the settlement it recommends. */
export function ApprovalMatrixPage() {
  const { data, isPending, isError, error } = useQuery({ queryKey: documentKeys.approvalTiers, queryFn: documentsApi.approvalTiers });
  if (isPending) return <Spinner />;
  if (isError) return <ErrorNote message={errorMessage(error)} />;
  return <MatrixEditor tiers={data} />;
}

function MatrixEditor({ tiers }: { tiers: ApprovalTier[] }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<Row[]>(() => tiers.map((t) => ({ label: t.label, minAmount: moneyToInput(t.minAmount), requiredApprovals: String(t.requiredApprovals) })));
  const save = useMutation({
    mutationFn: () => documentsApi.saveApprovalTiers(rows.map((r) => ({ label: r.label, minAmount: moneyToApi(r.minAmount) ?? "", requiredApprovals: Number(r.requiredApprovals) }))),
    onSuccess: (t) => qc.setQueryData(documentKeys.approvalTiers, t),
  });
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <>
      <PageHeader
        title="Approval matrix"
        description="How many principal adjusters must sign off a final report before its PDF is released, by the settlement it recommends. A report keeps the tier it had when it was submitted."
      />
      <Card>
        <div className="space-y-3">
          <div className="hidden grid-cols-[1fr_14rem_10rem_auto] gap-3 text-xs font-medium text-slate-500 sm:grid">
            <span>Tier</span><span>Recommended settlement from</span><span>Sign-offs needed</span><span />
          </div>
          {rows.map((r, i) => (
            <div key={i} className="grid gap-3 sm:grid-cols-[1fr_14rem_10rem_auto]">
              <Input aria-label="Tier name" value={r.label} onChange={(e) => set(i, { label: e.target.value })} />
              <MoneyInput aria-label="From amount" value={r.minAmount} onChange={(v) => set(i, { minAmount: v })} />
              <Input aria-label="Sign-offs needed" type="number" min={1} max={5} value={r.requiredApprovals} onChange={(e) => set(i, { requiredApprovals: e.target.value })} />
              <Button variant="ghost" aria-label="Remove tier" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          {save.isError && <ErrorNote message={errorMessage(save.error)} />}
          {save.isSuccess && <p className="text-sm text-emerald-700">Saved.</p>}
          <div className="flex flex-wrap justify-between gap-2 pt-2">
            <Button variant="secondary" onClick={() => setRows([...rows, { label: "", minAmount: "", requiredApprovals: "2" }])}><Plus className="size-4" /> Add tier</Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>Save matrix</Button>
          </div>
          <p className="text-xs text-slate-500">
            Preliminary reports always need one sign-off. The author of a report counts towards its sign-offs only when there aren't enough other active
            principal adjusters, and must say why.
          </p>
        </div>
      </Card>
    </>
  );
}
