import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router";
import { AlertCircle, Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { errorMessage } from "@/shared/api/client";
import { useAuth } from "./AuthContext";

const DEMO_ACCOUNTS = [
  ["Principal Adjuster", "principal@pinnacle-adjusters.example"],
  ["Loss Adjuster", "chiamaka.eze@pinnacle-adjusters.example"],
  ["Insurer", "ngozi.okafor@lagoonassurance.example"],
] as const;

export function LoginPage() {
  const { status, signIn } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? "/";
  if (status === "signedIn") return <Navigate to={from} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-dvh">
      <aside className="relative hidden w-[44%] flex-col justify-between overflow-hidden bg-brand-900 p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-lg bg-white/10">
            <ShieldCheck className="size-6 text-brand-100" />
          </div>
          <span className="text-lg font-semibold tracking-tight">Loss Adjuster Claims</span>
        </div>
        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">
            From instruction to signed-off report, in one place.
          </h1>
          <p className="mt-4 text-brand-100/80">
            Track every instruction, inspection and schedule of loss across Motor, Marine, Property and Oil &amp; Gas
            claims, with Naira figures your insurers can trust.
          </p>
        </div>
        <p className="text-sm text-brand-100/60">For loss adjusters, principal adjusters and instructing insurers.</p>
        <div className="pointer-events-none absolute -right-24 -bottom-24 size-96 rounded-full bg-brand-600/30 blur-3xl" />
      </aside>

      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <ShieldCheck className="size-7 text-brand-600" />
            <span className="font-semibold">Loss Adjuster Claims</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Use the email address your firm registered for you.</p>

          <form onSubmit={onSubmit} noValidate className="mt-8 space-y-5">
            {error && (
              <div role="alert" className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700">
                Password
              </label>
              <div className="relative mt-1.5">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 pr-11 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white shadow-sm hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60"
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              Sign in
            </button>
          </form>

          {import.meta.env.DEV && (
            <div className="mt-10 rounded-lg border border-dashed border-slate-300 p-4 text-xs text-slate-500">
              <p className="font-medium text-slate-600">Development accounts (password from SEED_PASSWORD)</p>
              <ul className="mt-2 space-y-1">
                {DEMO_ACCOUNTS.map(([label, addr]) => (
                  <li key={addr}>
                    <button type="button" className="text-left hover:text-brand-700" onClick={() => setEmail(addr)}>
                      <span className="font-medium">{label}:</span> {addr}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
