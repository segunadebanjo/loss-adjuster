import { Construction } from "lucide-react";
import { PageHeader } from "./PageHeader";

export function ComingSoon({ title, phase, children }: { title: string; phase: number; children?: React.ReactNode }) {
  return (
    <>
      {title && <PageHeader title={title} />}
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <Construction className="mx-auto size-8 text-slate-400" />
        <p className="mt-3 font-medium">Arrives in Phase {phase}</p>
        {children && <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{children}</p>}
      </div>
    </>
  );
}
