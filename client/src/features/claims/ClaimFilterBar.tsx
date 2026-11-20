import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { claimsApi, queryKeys } from "@/shared/api/claims";
import { useAuth } from "@/features/auth/AuthContext";
import { Button, Input, Select } from "@/shared/components/ui";
import type { Filters } from "./useClaimFilters";

interface Props {
  filters: Filters;
  setFilter: (patch: Filters) => void;
  clear: () => void;
  active: number;
  /** The claims list also filters by text and status; the dashboard doesn't. */
  showSearch?: boolean;
}

const label = "sr-only";

export function ClaimFilterBar({ filters, setFilter, clear, active, showSearch }: Props) {
  const { user } = useAuth();
  const { data: options } = useQuery({ queryKey: queryKeys.options, queryFn: claimsApi.options, staleTime: 5 * 60_000 });
  const [q, setQ] = useState(filters.q ?? "");

  // Search as you type, a moment after typing stops.
  useEffect(() => {
    if ((filters.q ?? "") === q) return;
    const t = setTimeout(() => setFilter({ q: q.trim() || undefined }), 350);
    return () => clearTimeout(t);
  }, [q, filters.q, setFilter]);

  const staff = user?.role !== "INSURER";
  return (
    <div className="flex flex-wrap items-end gap-2">
      {showSearch && (
        <div className="relative min-w-56 flex-1">
          <label htmlFor="f-q" className={label}>Search</label>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <Input id="f-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Claim ref, policy no., insured, NAICOM UID…" className="pl-9" />
        </div>
      )}
      {showSearch && (
        <div>
          <label htmlFor="f-status" className={label}>Status</label>
          <Select id="f-status" value={filters.status ?? filters.state ?? ""} onChange={(e) => {
            const v = e.target.value;
            setFilter(v === "open" || v === "closed" ? { state: v, status: undefined } : { status: v || undefined, state: undefined });
          }} className="w-48">
            <option value="">All statuses</option>
            <option value="open">Open claims</option>
            <option value="closed">Closed claims</option>
            {options?.statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
        </div>
      )}
      <div>
        <label htmlFor="f-line" className={label}>Line of business</label>
        <Select id="f-line" value={filters.line ?? ""} onChange={(e) => setFilter({ line: e.target.value || undefined })} className="w-40">
          <option value="">All lines</option>
          {options?.lines.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </Select>
      </div>
      {staff && (
        <div>
          <label htmlFor="f-insurer" className={label}>Insurer</label>
          <Select id="f-insurer" value={filters.insurerId ?? ""} onChange={(e) => setFilter({ insurerId: e.target.value || undefined })} className="w-52">
            <option value="">All insurers</option>
            {options?.insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
        </div>
      )}
      {user?.role === "ADMIN" && (
        <div>
          <label htmlFor="f-adjuster" className={label}>Adjuster</label>
          <Select id="f-adjuster" value={filters.adjusterId ?? ""} onChange={(e) => setFilter({ adjusterId: e.target.value || undefined })} className="w-48">
            <option value="">All adjusters</option>
            <option value="unassigned">Unassigned</option>
            {options?.adjusters.map((a) => <option key={a.id} value={a.id}>{a.fullName}</option>)}
          </Select>
        </div>
      )}
      <div className="flex items-end gap-1">
        <div>
          <label htmlFor="f-from" className="block text-xs text-slate-500">Instructed from</label>
          <Input id="f-from" type="date" value={filters.from ?? ""} max={filters.to} onChange={(e) => setFilter({ from: e.target.value || undefined })} className="w-38" />
        </div>
        <div>
          <label htmlFor="f-to" className="block text-xs text-slate-500">to</label>
          <Input id="f-to" type="date" value={filters.to ?? ""} min={filters.from} onChange={(e) => setFilter({ to: e.target.value || undefined })} className="w-38" />
        </div>
      </div>
      {active > 0 && (
        <Button variant="ghost" onClick={() => { setQ(""); clear(); }}>
          <X className="size-4" /> Clear filters
        </Button>
      )}
    </div>
  );
}
