import type { HTMLAttributes,PropsWithChildren } from "react";

import { cn } from "../../lib/utils";

type CardProps = PropsWithChildren<Omit<HTMLAttributes<HTMLElement>, "style">>;

/** The one container surface. */
export function Card({ children, className, ...props }: CardProps) {
  return (
    <section {...props} className={cn("tg-card p-5", className)}>
      {children}
    </section>
  );
}
