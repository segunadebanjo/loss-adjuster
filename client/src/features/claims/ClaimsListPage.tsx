import { Link } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, FilePlus2 } from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { claimsApi, queryKeys } from "@/shared/api/claims";
import { errorMessage } from "@/shared/api/client";
import { Button, Card, ErrorNote, Spinner } from "@/shared/components/ui";
import { PageHeader } from "@/shared/components/PageHeader";
import { ClaimFilterBar } from "./ClaimFilterBar";
import { ClaimsTable } from "./ClaimsTable";
import { useClaimFilters } from "./useClaimFilters";

const PAGE_SIZE = 25;

export function ClaimsListPage() {
  const { user } = useAuth();
  const { filters, setFilter, clear, active } = useClaimFilters();
  const sort = filters.sort ?? "-dateInstructed";
  const page = Number(filters.page ?? 1);
  const query = { ...filters, sort, page: String(page), pageSize: String(PAGE_SIZE) };
  const { data, isPending, isError, error, isFetching } = useQuery({
    queryKey: [...queryKeys.claims, "list", query],
    queryFn: () => claimsApi.list(query),
    placeholderData: keepPreviousData,
  });
  const total = data?.meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const title = user?.role === "ADJUSTER" ? "My claims" : "Claims";

  return (
    <>
      <PageHeader
        title={title}
        description={data ? `${total.toLocaleString("en-NG")} claim${total === 1 ? "" : "s"}${active ? " match your filters" : ""}.` : undefined}
        actions={
          user?.role === "ADMIN" && (
            <Link to="/intake" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-brand-700">
              <FilePlus2 className="size-4" /> New instruction
            </Link>
          )
        }
      />
      <div className="mb-4">
        <ClaimFilterBar filters={filters} setFilter={setFilter} clear={clear} active={active} showSearch />
      </div>
      {isError && <ErrorNote message={errorMessage(error)} className="mb-4" />}
      <Card bodyClassName="p-0" className={isFetching && !isPending ? "opacity-70 transition-opacity" : ""}>
        {isPending ? <Spinner /> : data ? <ClaimsTable rows={data.data} sort={sort} onSort={(s) => setFilter({ sort: s })} /> : null}
        {data && pages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-sm">
            <span className="text-slate-500">
              Page {page} of {pages}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setFilter({ page: String(page - 1) })}>
                <ChevronLeft className="size-4" /> Previous
              </Button>
              <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setFilter({ page: String(page + 1) })}>
                Next <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
