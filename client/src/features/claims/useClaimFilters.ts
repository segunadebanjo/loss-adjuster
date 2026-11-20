import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";

export const FILTER_KEYS = ["q", "status", "state", "line", "insurerId", "adjusterId", "from", "to", "page", "sort"] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];
export type Filters = Partial<Record<FilterKey, string>>;

/** Filters kept in the address bar, so a filtered view can be bookmarked or shared. */
export function useClaimFilters() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo<Filters>(() => {
    const f: Filters = {};
    for (const k of FILTER_KEYS) {
      const v = params.get(k);
      if (v) f[k] = v;
    }
    return f;
  }, [params]);

  const setFilter = useCallback(
    (patch: Filters) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v) next.set(k, v);
            else next.delete(k);
          }
          // Any filter change goes back to the first page.
          if (!("page" in patch)) next.delete("page");
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const clear = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);
  const active = Object.keys(filters).filter((k) => k !== "page" && k !== "sort").length;
  return { filters, setFilter, clear, active };
}
