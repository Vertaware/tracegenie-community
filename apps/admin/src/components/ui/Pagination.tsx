import { ChevronLeft,ChevronRight } from "lucide-react";

type PaginationProps = {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  total?: number;
  pageSize?: number;
  hideWhenSinglePage?: boolean;
};

export function Pagination({ page, pageCount, onPage, total, pageSize, hideWhenSinglePage = false }: PaginationProps) {
  if (hideWhenSinglePage && pageCount <= 1) {
    return null;
  }

  const from = total != null && pageSize != null ? (page - 1) * pageSize + 1 : null;
  const to = total != null && pageSize != null ? Math.min(page * pageSize, total) : null;

  // The count label renders even on single-page lists: confirmation of
  // completeness is exactly when users look for it.
  const label =
    total != null && pageCount <= 1
      ? `${total} ${total === 1 ? "item" : "items"}`
      : from != null && to != null && total != null
        ? `${from}-${to} of ${total}`
        : `Page ${page} of ${pageCount}`;

  return (
    <div
      id="pagination-bar"
      className="flex flex-col gap-1.5 border-t border-border/25 bg-surface px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
    >
      <p className="text-center text-caption tabular-nums text-muted sm:text-left">{label}</p>

      {pageCount > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-1 sm:justify-end">
          <button
            id="pagination-prev"
            type="button"
            onClick={() => onPage(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
            className="tg-icon-button flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-caption font-medium text-muted transition-colors hover:bg-surface-muted/45 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-30 sm:size-8 sm:min-w-8 sm:px-0"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            <span className="sm:hidden">Previous</span>
          </button>

          <div className="hidden items-center gap-1 sm:flex">
            {Array.from({ length: pageCount }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === pageCount || Math.abs(p - page) <= 1)
              .reduce<(number | "ellipsis")[]>((acc, p, idx, arr) => {
                if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) acc.push("ellipsis");
                acc.push(p);
                return acc;
              }, [])
              .map((p, i) =>
                p === "ellipsis" ? (
                  <span key={`ellipsis-${i}`} className="px-1 text-caption text-muted/60">&hellip;</span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    onClick={() => onPage(p as number)}
                    aria-current={p === page ? "page" : undefined}
                    aria-label={`Page ${p}`}
                    className={`tg-icon-button flex h-8 min-w-8 items-center justify-center rounded-full px-1.5 text-caption font-medium tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
                      p === page
                        ? "bg-primary text-white"
                        : "text-muted hover:bg-surface-muted/45 hover:text-foreground"
                    }`}
                  >
                    {p}
                  </button>
                ),
              )}
          </div>

          <button
            id="pagination-next"
            type="button"
            onClick={() => onPage(page + 1)}
            disabled={page >= pageCount}
            aria-label="Next page"
            className="tg-icon-button flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-caption font-medium text-muted transition-colors hover:bg-surface-muted/45 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-30 sm:size-8 sm:min-w-8 sm:px-0"
          >
            <span className="sm:hidden">Next</span>
            <ChevronRight aria-hidden="true" className="size-4" />
          </button>
        </nav>
      ) : null}
    </div>
  );
}
