import { cn } from "../../lib/utils";

type SkeletonProps = {
  className?: string;
  variant?: "line" | "card" | "chart";
};

export function Skeleton({ className, variant = "line" }: SkeletonProps) {
  return (
    <div
      className={cn(
        "tg-skeleton",
        variant === "line" && "h-4 w-full",
        variant === "card" && "h-28 w-full",
        variant === "chart" && "h-72 w-full",
        className,
      )}
      aria-hidden="true"
    />
  );
}

export function SkeletonTableRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-4" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-5 w-2/5" />
          <Skeleton className="h-5 w-1/5" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-24" />
        </div>
      ))}
    </div>
  );
}
