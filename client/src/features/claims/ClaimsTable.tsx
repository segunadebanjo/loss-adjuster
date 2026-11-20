import { Link } from "react-router";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { ClaimListItem } from "@/shared/api/types";
import { formatNaira } from "@/shared/lib/money";
import { POLICY_TYPE_LABEL, formatDate } from "@/shared/lib/claims";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { EmptyState } from "@/shared/components/ui";

interface Props {
  rows: ClaimListItem[];
  compact?: boolean;
  sort?: string;
  onSort?: (field: string) => void;
}

function SortHeader({ field, label, sort, onSort, align = "left" }: { field: string; label: string; sort?: string; onSort?: (f: string) => void; align?: "left" | "right" }) {
  if (!onSort) return <>{label}</>;
  const active = sort?.replace(/^-/, "") === field;
  const desc = sort?.startsWith("-");
  return (
    <button onClick={() => onSort(active && !desc ? `-${field}` : field)} className={`inline-flex items-center gap-1 hover:text-slate-800 ${align === "right" ? "flex-row-reverse" : ""}`}>
      {label}
      {active && (desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
    </button>
  );
}

/** Claims as a table on wide screens and as cards on phones. */
export function ClaimsTable({ rows, compact, sort, onSort }: Props) {
  if (!rows.length) return <EmptyState title="No claims match">Try clearing a filter.</EmptyState>;
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr className="border-b border-slate-100">
              <th className="px-5 py-2.5 font-medium"><SortHeader field="claimReference" label="Claim" sort={sort} onSort={onSort} /></th>
              <th className="px-3 py-2.5 font-medium">Insured / policy</th>
              {!compact && <th className="px-3 py-2.5 font-medium">Insurer</th>}
              <th className="px-3 py-2.5 font-medium">Adjuster</th>
              <th className="px-3 py-2.5 font-medium"><SortHeader field="status" label="Status" sort={sort} onSort={onSort} /></th>
              <th className="px-3 py-2.5 font-medium"><SortHeader field="dateInstructed" label="Instructed" sort={sort} onSort={onSort} /></th>
              <th className="px-5 py-2.5 text-right font-medium"><SortHeader field="initialReserve" label="Reserve" sort={sort} onSort={onSort} align="right" /></th>
              {!compact && <th className="px-5 py-2.5 text-right font-medium">Recommended</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/70">
                <td className="px-5 py-3">
                  <Link to={`/claims/${c.id}`} className="font-medium text-brand-700 hover:underline">{c.claimReference}</Link>
                  <p className="text-xs text-slate-500">{c.lossState}{c.lossLga ? `, ${c.lossLga}` : ""}</p>
                </td>
                <td className="max-w-64 px-3 py-3">
                  <p className="truncate">{c.policy.insuredName}</p>
                  <p className="truncate text-xs text-slate-500">{POLICY_TYPE_LABEL[c.policy.policyType]} · {c.policy.policyNumber}</p>
                </td>
                {!compact && <td className="max-w-48 truncate px-3 py-3">{c.policy.insurerName}</td>}
                <td className="px-3 py-3 whitespace-nowrap">{c.assignedAdjuster?.fullName ?? <span className="text-amber-800">Unassigned</span>}</td>
                <td className="px-3 py-3"><StatusBadge status={c.status} /></td>
                <td className="px-3 py-3 whitespace-nowrap">
                  {formatDate(c.dateInstructed)}
                  <p className="text-xs text-slate-500">{c.daysOpen} day{c.daysOpen === 1 ? "" : "s"}</p>
                </td>
                <td className="px-5 py-3 text-right whitespace-nowrap tabular-nums">{formatNaira(c.initialReserve)}</td>
                {!compact && <td className="px-5 py-3 text-right whitespace-nowrap tabular-nums">{formatNaira(c.settledAmount ?? c.recommendedSettlement)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-slate-100 md:hidden">
        {rows.map((c) => (
          <li key={c.id}>
            <Link to={`/claims/${c.id}`} className="block px-4 py-3 active:bg-slate-50">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-brand-700">{c.claimReference}</p>
                  <p className="truncate text-sm">{c.policy.insuredName}</p>
                </div>
                <StatusBadge status={c.status} />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
                <span>{POLICY_TYPE_LABEL[c.policy.policyType]}</span>
                <span>{c.lossState}</span>
                <span>{formatDate(c.dateInstructed)}</span>
                <span className="tabular-nums">Reserve {formatNaira(c.initialReserve)}</span>
                <span>{c.assignedAdjuster?.fullName ?? "Unassigned"}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
