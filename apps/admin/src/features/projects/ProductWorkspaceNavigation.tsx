import { Link } from "react-router-dom";

export type ProductWorkspaceSection = "overview" | "issues" | "settings";

export function ProductWorkspaceNavigation({
  projectPath,
  activeSection,
}: {
  projectPath: string;
  activeSection: ProductWorkspaceSection;
}) {
  const projectKey = decodeURIComponent(projectPath.split("/").pop() ?? "");
  return (
    <nav id="product-workspace-navigation" aria-label="Product sections" className="inline-flex w-fit max-w-full flex-wrap rounded-xl border border-border/55 bg-surface p-1 shadow-soft">
      {[
        ...(activeSection === "overview" ? [{ label: "Setup", to: projectPath, section: "overview" as const }] : []),
        { label: "Issues", to: `/issues?${new URLSearchParams({ projectKey }).toString()}`, section: "issues" as const },
        { label: "Settings", to: `${projectPath}/settings`, section: "settings" as const },
      ].map((item) => {
        const isCurrent = item.section === activeSection;
        return (
          <Link
            key={item.section}
            to={item.to}
            aria-current={isCurrent ? "page" : undefined}
            className={`inline-flex min-h-10 items-center rounded-lg px-4 text-label font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-primary ${isCurrent ? "bg-primary-light text-primary shadow-soft" : "text-muted hover:bg-surface-muted/50 hover:text-foreground"}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
