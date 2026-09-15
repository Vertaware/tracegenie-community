import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";

import { TraceLogo } from "../../components/ui/TraceLogo";

type AuthShellProps = {
  idPrefix: string;
  pageId?: string;
  cardId?: string;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  trustDescription?: string;
  showTrustDetails?: boolean;
  variant?: "default" | "simple";
  width?: "standard" | "wide";
};

const widthClasses = {
  standard: "max-w-md",
  wide: "max-w-xl",
};

export function AuthShell({
  idPrefix,
  pageId,
  cardId,
  title,
  description,
  children,
  footer,
  trustDescription = "TraceGenie separates reports by organization and product access.",
  showTrustDetails = true,
  variant = "default",
  width = "standard",
}: AuthShellProps) {
  const titleId = `${idPrefix}-title`;
  const descriptionId = description ? `${idPrefix}-description` : undefined;
  const simple = variant === "simple";

  return (
    <main
      id={pageId ?? `${idPrefix}-page`}
      className={`tg-public-entry flex min-h-screen justify-center bg-background px-4 py-6 ${
        simple ? "items-center sm:py-10" : "items-start sm:py-14 lg:py-20"
      }`}
    >
      <section
        id={cardId ?? `${idPrefix}-card`}
        className={`tg-auth-card w-full ${widthClasses[width]} overflow-hidden rounded-2xl border border-border bg-surface shadow-panel`}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <div
          id={`${idPrefix}-trust-bar`}
          className={simple
            ? "flex items-center justify-center px-6 pb-0 pt-8"
            : "flex min-h-16 items-center justify-between gap-4 border-b border-border/70 px-6 py-3"}
        >
          <TraceLogo variant="full" size="sm" />
          {simple || !showTrustDetails ? null : (
            <p className="flex items-center gap-1.5 text-caption font-medium text-muted">
              <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
              Organization-scoped access
            </p>
          )}
        </div>

        <div
          id={`${idPrefix}-shell-content`}
          className={simple ? "px-6 pb-8 pt-5 sm:px-8" : "px-6 py-7 sm:px-8 sm:py-8"}
        >
          <header id={`${idPrefix}-header`} className={simple ? "text-center" : undefined}>
            <h1 id={titleId} className="text-display text-foreground">
              {title}
            </h1>
            {description ? (
              <p id={descriptionId} className="mt-2 text-body leading-relaxed text-muted">
                {description}
              </p>
            ) : null}
          </header>

          <div id={`${idPrefix}-body`}>
            {children}
          </div>

          {footer ? (
            <footer
              id={`${idPrefix}-footer`}
              className={`text-caption text-muted ${simple ? "mt-6 text-center" : "mt-5"}`}
            >
              {footer}
            </footer>
          ) : null}
        </div>

        {simple || !showTrustDetails ? null : (
          <aside
            id={`${idPrefix}-trust`}
            className="border-t border-border/70 bg-surface-muted/35 px-6 py-4 sm:px-8"
            aria-label="Access boundary"
          >
            <p className="text-caption leading-relaxed text-muted">{trustDescription}</p>
          </aside>
        )}
      </section>
    </main>
  );
}
