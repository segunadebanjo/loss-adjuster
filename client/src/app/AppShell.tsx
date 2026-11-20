import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router";
import { LogOut, Menu, ShieldCheck, X } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "@/features/auth/AuthContext";
import { NAV_ITEMS, ROLE_LABEL } from "./nav";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function AppShell() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);

  // The mobile drawer closes when a link is picked (onClick below) and on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!user) return null;
  const items = NAV_ITEMS.filter((i) => i.roles.includes(user.role));

  const sidebar = (
    <nav className="flex h-full flex-col bg-brand-900 text-brand-50">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <ShieldCheck className="size-6 text-brand-100" />
        <span className="font-semibold tracking-tight">Loss Adjuster Claims</span>
      </div>
      <ul className="flex-1 space-y-1 px-3 py-4">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === "/"}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                clsx(
                  "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                  isActive ? "bg-white/12 text-white" : "text-brand-100/80 hover:bg-white/6 hover:text-white",
                )
              }
            >
              <item.icon className="size-4.5 shrink-0" />
              {item.labelFor?.[user.role] ?? item.label}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="border-t border-white/10 p-4 text-xs text-brand-100/60">
        {user.organisation ? user.organisation.name : "Pinnacle Loss Adjusters Ltd"}
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh lg:block">{sidebar}</aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-xl">{sidebar}</div>
          <button
            onClick={() => setOpen(false)}
            className="absolute top-3 right-3 grid size-11 place-items-center rounded-lg text-white"
            aria-label="Close navigation"
          >
            <X className="size-5" />
          </button>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button
            onClick={() => setOpen(true)}
            className="-ml-2 grid size-11 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="size-5" />
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm leading-tight font-medium">{user.fullName}</p>
              <p className="text-xs text-slate-500">
                {ROLE_LABEL[user.role]}
                {user.ciiQualification ? ` · ${user.ciiQualification}` : ""}
              </p>
            </div>
            <div className="grid size-9 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
              {initials(user.fullName)}
            </div>
            <button
              onClick={() => void signOut()}
              className="grid size-11 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="size-4.5" />
            </button>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
