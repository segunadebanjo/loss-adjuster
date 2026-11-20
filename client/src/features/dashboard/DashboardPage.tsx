import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleDot, ClipboardList, Clock, FilePlus2, MapPinned, TrendingDown, Wallet, XCircle } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "@/features/auth/AuthContext";
import { ClaimFilterBar } from "@/features/claims/ClaimFilterBar";
import { useClaimFilters } from "@/features/claims/useClaimFilters";
import { ClaimsTable } from "@/features/claims/ClaimsTable";
import { claimsApi, queryKeys } from "@/shared/api/claims";
import { errorMessage } from "@/shared/api/client";
import type { DashboardKpis, SlaState } from "@/shared/api/types";
import { formatNaira } from "@/shared/lib/money";
import { STATUS_LABEL } from "@/shared/lib/claims";
import { Card, ErrorNote, Spinner } from "@/shared/components/ui";
import { PageHeader } from "@/shared/components/PageHeader";

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-NG", { hour: "numeric", hour12: false, timeZone: "Africa/Lagos" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function Kpi({ icon: Icon, label, value, sub, to }: { icon: typeof Clock; label: string; value: string; sub?: React.ReactNode; to?: string }) {
  const body = (
    <>
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Icon className="size-4" /> {label}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </>
  );
  const cls = "block rounded-xl border border-slate-200 bg-white p-5 shadow-sm";
  return to ? (
    <Link to={to} className={clsx(cls, "transition-colors hover:border-brand-500/50")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

// Fixed status colours (never reused for series); each always appears with an icon and a label.
const SLA_SEGMENTS: Array<{ state: SlaState; label: string; color: string; icon: typeof Clock }> = [
  { state: "MET", label: "Met", color: "#0ca30c", icon: CheckCircle2 },
  { state: "ON_TRACK", label: "On track", color: "#94a3b8", icon: CircleDot },
  { state: "AT_RISK", label: "At risk", color: "#fab219", icon: AlertTriangle },
  { state: "BREACHED", label: "Overdue", color: "#ec835a", icon: Clock },
  { state: "MISSED", label: "Missed", color: "#d03b3b", icon: XCircle },
];

function SlaTracker({ sla }: { sla: DashboardKpis["sla"] }) {
  return (
    <Card title="SLA turnaround" actions={<span className="text-xs text-slate-500">claims per milestone</span>}>
      <ul className="space-y-5">
        {sla.map((m) => {
          const total = SLA_SEGMENTS.reduce((s, seg) => s + m.counts[seg.state], 0);
          return (
            <li key={m.key}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 text-sm font-medium">
                  {m.label}
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    target {m.targetDays} {m.businessDays ? "working " : ""}day{m.targetDays === 1 ? "" : "s"}
                  </span>
                </p>
                <p className="shrink-0 text-sm whitespace-nowrap tabular-nums text-slate-700">
                  {m.onTimeRate == null ? "—" : `${m.onTimeRate}% on time`}
                </p>
              </div>
              <div className="mt-2 flex h-2 gap-0.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${m.label}: ${SLA_SEGMENTS.map((s) => `${m.counts[s.state]} ${s.label.toLowerCase()}`).join(", ")}`}>
                {total > 0 &&
                  SLA_SEGMENTS.filter((s) => m.counts[s.state] > 0).map((s) => (
                    <div key={s.state} title={`${s.label}: ${m.counts[s.state]}`} style={{ width: `${(m.counts[s.state] / total) * 100}%`, background: s.color }} className="h-full first:rounded-l-full last:rounded-r-full" />
                  ))}
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                {SLA_SEGMENTS.filter((s) => m.counts[s.state] > 0).map((s) => (
                  <li key={s.state} className="flex items-center gap-1">
                    <s.icon className="size-3.5" style={{ color: s.color }} aria-hidden />
                    {s.label} <span className="font-medium tabular-nums text-slate-800">{m.counts[s.state]}</span>
                  </li>
                ))}
                {total === 0 && <li className="text-slate-400">Nothing to time yet</li>}
              </ul>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Single-series horizontal bars: one hue, value at the tip, each row a link. */
function BarList({ rows, max }: { rows: Array<{ key: string; label: string; value: number; to?: string }>; max: number }) {
  return (
    <ul className="space-y-1">
      {rows.map((r) => {
        const inner = (
          <>
            <span className="w-44 shrink-0 truncate text-sm text-slate-700">{r.label}</span>
            <span className="relative h-5 flex-1">
              {r.value > 0 && <span className="absolute inset-y-0.5 left-0 rounded-r bg-brand-500" style={{ width: `${Math.max(2, (r.value / Math.max(max, 1)) * 100)}%` }} />}
            </span>
            <span className="w-8 text-right text-sm font-medium tabular-nums">{r.value}</span>
          </>
        );
        return (
          <li key={r.key}>
            {r.to ? (
              <Link to={r.to} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-1 hover:bg-slate-50" title={`${r.label}: ${r.value}`}>
                {inner}
              </Link>
            ) : (
              <div className="flex items-center gap-3 py-1">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const { filters, setFilter, clear, active } = useClaimFilters();
  const scope = { line: filters.line, insurerId: filters.insurerId, adjusterId: filters.adjusterId, from: filters.from, to: filters.to };
  const kpis = useQuery({ queryKey: [...queryKeys.kpis, scope], queryFn: () => claimsApi.kpis(scope) });
  const recent = useQuery({ queryKey: [...queryKeys.claims, "recent", scope], queryFn: () => claimsApi.list({ ...scope, state: "open", pageSize: "6", sort: "-dateInstructed" }) });

  if (!user) return null;
  const listLink = (extra: Record<string, string>) => `/claims?${new URLSearchParams(Object.entries({ ...scope, ...extra }).filter(([, v]) => v) as Array<[string, string]>)}`;
  const k = kpis.data;
  const cva = k?.claimedVsAdjusted;
  const insurer = user.role === "INSURER";

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${user.fullName.split(" ")[0]}`}
        description={insurer ? `Claims ${user.organisation?.name ?? "you"} instructed us on.` : user.role === "ADJUSTER" ? "Your assigned claims at a glance." : "The firm's claims at a glance."}
        actions={
          user.role === "ADMIN" && (
            <Link to="/intake" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-brand-700">
              <FilePlus2 className="size-4" /> New instruction
            </Link>
          )
        }
      />
      <div className="mb-6">
        <ClaimFilterBar filters={filters} setFilter={setFilter} clear={clear} active={active} />
      </div>

      {kpis.isPending && <Spinner />}
      {kpis.isError && <ErrorNote message={errorMessage(kpis.error)} />}
      {k && cva && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              icon={ClipboardList}
              label="Active instructions"
              value={k.activeInstructions.toLocaleString("en-NG")}
              to={listLink({ state: "open" })}
              sub={!insurer && k.unassigned > 0 ? <span className="text-amber-800">{k.unassigned} not yet assigned</span> : `${k.closedClaims} closed`}
            />
            <Kpi
              icon={MapPinned}
              label="Pending site inspections"
              value={k.pendingInspections.total.toLocaleString("en-NG")}
              to={listLink({ status: "NEW_INSTRUCTION,INSPECTION_SCHEDULED" })}
              sub={`${k.pendingInspections.unscheduled} not scheduled${k.pendingInspections.overdue ? ` · ${k.pendingInspections.overdue} overdue` : ""}`}
            />
            <Kpi
              icon={TrendingDown}
              label={insurer ? "Claimed vs settled" : "Claimed vs adjusted"}
              value={formatNaira(cva.totalAdjusted, { compact: true })}
              sub={
                cva.claimsCompared === 0 ? (
                  "No adjusted claims yet"
                ) : (
                  <>
                    of {formatNaira(cva.totalClaimed, { compact: true })} claimed ·{" "}
                    <span className="font-medium text-emerald-800">
                      {formatNaira(cva.savings, { compact: true })} saved ({cva.savingsPercent}%)
                    </span>
                  </>
                )
              }
            />
            <Kpi icon={Wallet} label="Open reserves" value={formatNaira(k.openReserve, { compact: true })} sub={formatNaira(k.openReserve)} />
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <SlaTracker sla={k.sla} />
            </div>
            <div className="lg:col-span-2">
              <Card title="Claims by status">
                <BarList
                  max={Math.max(...k.byStatus.map((s) => s.count))}
                  rows={k.byStatus.map((s) => ({ key: s.status, label: STATUS_LABEL[s.status], value: s.count, to: listLink({ status: s.status }) }))}
                />
              </Card>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <div className={user.role === "ADMIN" ? "lg:col-span-3" : "lg:col-span-5"}>
              <Card title="By line of business" bodyClassName="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-slate-500">
                      <tr className="border-b border-slate-100">
                        <th className="px-5 py-2 font-medium">Line</th>
                        <th className="px-3 py-2 text-right font-medium">Claims</th>
                        <th className="px-3 py-2 text-right font-medium">Open</th>
                        <th className="px-5 py-2 text-right font-medium">Open reserve</th>
                      </tr>
                    </thead>
                    <tbody>
                      {k.byLine.map((l) => (
                        <tr key={l.line} className="border-b border-slate-50 last:border-0">
                          <td className="px-5 py-2.5">
                            <Link className="hover:text-brand-700 hover:underline" to={listLink({ line: l.line })}>{l.label}</Link>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{l.count}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{l.open}</td>
                          <td className="px-5 py-2.5 text-right tabular-nums">{formatNaira(l.openReserve)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
            {user.role === "ADMIN" && (
              <div className="lg:col-span-2">
                <Card title="Open claims per adjuster">
                  <BarList
                    max={Math.max(...k.workload.map((w) => w.open))}
                    rows={k.workload.map((w) => ({ key: String(w.adjusterId), label: w.fullName, value: w.open, to: listLink({ adjusterId: String(w.adjusterId), state: "open" }) }))}
                  />
                </Card>
              </div>
            )}
          </div>

          <Card title="Latest open instructions" actions={<Link to={listLink({ state: "open" })} className="text-sm font-medium text-brand-700 hover:underline">View all</Link>} bodyClassName="p-0">
            {recent.isPending ? <Spinner /> : recent.data ? <ClaimsTable rows={recent.data.data} compact /> : null}
          </Card>
        </div>
      )}
    </>
  );
}
