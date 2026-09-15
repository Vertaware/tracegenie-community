import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

/** Keep identity, return navigation and workspace navigation in one compact group. */
export function PageHeader({ id, back, navigation, children }: {
  id?: string;
  back?: ReactNode;
  navigation?: ReactNode;
  children: ReactNode;
}) {
  return (
    <header id={id} className="space-y-1">
      {back}
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 flex-1">{children}</div>
        {navigation ? <div className="max-w-full shrink-0">{navigation}</div> : null}
      </div>
    </header>
  );
}

export function PageBackLink({ to, children, id }: { to: string; children: ReactNode; id?: string }) {
  return (
    <Link id={id} to={to} className="tg-inline-link inline-flex min-h-10 items-center gap-1.5 rounded text-label font-medium text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">
      <ArrowLeft className="size-4" aria-hidden="true" />
      {children}
    </Link>
  );
}
