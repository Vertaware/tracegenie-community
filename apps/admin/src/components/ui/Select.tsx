import type { SelectHTMLAttributes } from "react";

import { cn } from "../../lib/utils";

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "style">;

export function Select(props: SelectProps) {
  return (
    <select
      {...props}
      className={cn(
        "tg-soft-input h-10 w-full rounded-lg border px-3 text-body text-foreground outline-none transition focus:border-primary focus:ring-3 focus:ring-primary/15",
        props.className,
      )}
    />
  );
}
