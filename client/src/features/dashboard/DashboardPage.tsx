import { BadgeCheck, Building2, Mail, Phone } from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { ROLE_LABEL } from "@/app/nav";
import { PageHeader } from "@/shared/components/PageHeader";

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-NG", { hour: "numeric", hour12: false, timeZone: "Africa/Lagos" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** Phase 1 placeholder: the signed-in profile. KPI cards and the claims pipeline come in Phase 2. */
export function DashboardPage() {
  const { user } = useAuth();
  if (!user) return null;
  const firstName = user.fullName.split(" ")[0];
  const rows: Array<[typeof Mail, string, string | null]> = [
    [Mail, "Email", user.email],
    [Phone, "Phone", user.phone],
    [BadgeCheck, "NAICOM licence", user.naicomLicenseNo],
    [BadgeCheck, "CII qualification", user.ciiQualification],
    [Building2, "Organisation", user.organisation?.name ?? null],
  ];
  return (
    <>
      <PageHeader title={`${greeting()}, ${firstName}`} description={`Signed in as ${ROLE_LABEL[user.role]}.`} />
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
          <h2 className="font-semibold">Your profile</h2>
          <dl className="mt-4 divide-y divide-slate-100">
            {rows
              .filter(([, , v]) => v)
              .map(([Icon, label, value]) => (
                <div key={label} className="flex items-center gap-3 py-3 text-sm">
                  <Icon className="size-4 text-slate-400" />
                  <dt className="w-40 shrink-0 text-slate-500">{label}</dt>
                  <dd className="min-w-0 truncate font-medium">{value}</dd>
                </div>
              ))}
          </dl>
        </section>
        <section className="rounded-xl border border-brand-100 bg-brand-50 p-6">
          <h2 className="font-semibold text-brand-900">Coming next</h2>
          <p className="mt-2 text-sm text-brand-900/70">
            Phase 2 adds the dashboard KPIs (active instructions, pending inspections, claimed vs adjusted in ₦, SLA
            tracker), the claims pipeline and instruction intake.
          </p>
        </section>
      </div>
    </>
  );
}
