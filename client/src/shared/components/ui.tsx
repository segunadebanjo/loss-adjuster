import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import clsx from "clsx";
import { AlertCircle, Inbox, Loader2, X } from "lucide-react";

type Variant = "primary" | "secondary" | "danger" | "ghost";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm",
  secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 shadow-sm",
  danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
  ghost: "text-slate-600 hover:bg-slate-100",
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; size?: "sm" | "md" }>(
  function Button({ variant = "primary", loading, size = "md", className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={clsx(
          "inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-60",
          size === "md" ? "min-h-10 px-4 text-sm" : "min-h-8 px-3 text-xs",
          VARIANTS[variant],
          className,
        )}
        {...rest}
      >
        {loading && <Loader2 className="size-4 animate-spin" />}
        {children}
      </button>
    );
  },
);

export function Card({ title, actions, children, className, bodyClassName }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={clsx("rounded-xl border border-slate-200 bg-white shadow-sm", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          {typeof title === "string" ? <h2 className="text-sm font-semibold">{title}</h2> : title}
          {actions}
        </header>
      )}
      <div className={clsx("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

const control =
  "block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 shadow-sm outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-50 disabled:text-slate-500 aria-[invalid=true]:border-red-400";

export function Field({ label, error, hint, children, required, className }: { label: string; error?: string; hint?: string; children: (id: string, describedBy?: string) => ReactNode; required?: boolean; className?: string }) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
        {required && <span aria-hidden="true" className="text-red-600"> *</span>}
      </label>
      <div className="mt-1.5">{children(id, error || hint ? msgId : undefined)}</div>
      {error ? (
        <p id={msgId} className="mt-1 text-xs text-red-700">{error}</p>
      ) : hint ? (
        <p id={msgId} className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={clsx(control, className)} {...rest} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...rest }, ref) {
  return <select ref={ref} className={clsx(control, "pr-8", className)} {...rest} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={clsx(control, className)} {...rest} />;
});

/** Naira amount box: shows ₦, accepts digits, commas and 2 decimals, keeps the typed text. */
export function MoneyInput({ value, onChange, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">₦</span>
      <Input
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
        onBlur={() => {
          const n = Number(value.replace(/,/g, ""));
          if (value.trim() && Number.isFinite(n)) onChange(n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
        }}
        className="pl-7 tabular-nums"
        {...rest}
      />
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
      <Loader2 className="size-5 animate-spin" /> {label}…
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="py-12 text-center">
      <Inbox className="mx-auto size-8 text-slate-300" />
      <p className="mt-2 font-medium text-slate-700">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function ErrorNote({ message, className }: { message: string; className?: string }) {
  return (
    <div role="alert" className={clsx("flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800", className)}>
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

/** Accessible modal: focus moves in, Escape and backdrop close, page behind doesn't scroll. */
export function Modal({ open, onClose, title, children, footer, size = "md" }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; size?: "md" | "lg" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLElement>("input, select, textarea, button:not([aria-label='Close'])")?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} />
      <div ref={ref} className={clsx("relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl", size === "lg" ? "sm:max-w-2xl" : "sm:max-w-md")}>
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="-mr-2 grid size-10 place-items-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X className="size-4" />
          </button>
        </header>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}
