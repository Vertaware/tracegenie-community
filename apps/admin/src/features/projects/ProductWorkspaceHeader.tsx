import { PageBackLink,PageHeader } from "../../components/ui/PageHeader";
import { ProductWorkspaceNavigation,type ProductWorkspaceSection } from "./ProductWorkspaceNavigation";

/** Product identity stays anchored while the selected workspace changes. */
export function ProductWorkspaceHeader({
  projectPath,
  projectName,
  activeSection,
  id,
  titleId,
  backLinkId,
  loading = false,
}: {
  projectPath: string;
  projectName?: string;
  activeSection: ProductWorkspaceSection;
  id?: string;
  titleId?: string;
  backLinkId?: string;
  loading?: boolean;
}) {
  return (
    <PageHeader
      id={id}
      back={activeSection === "settings" ? undefined : <PageBackLink id={backLinkId} to="/projects">Project</PageBackLink>}
      navigation={activeSection === "settings" ? undefined : <ProductWorkspaceNavigation projectPath={projectPath} activeSection={activeSection} />}
    >
      <div className="flex min-h-[50px] min-w-0 items-center px-1">
        {activeSection === "settings" ? (
          <div className="min-w-0">
            {projectName ? (
              <p className="text-caption font-medium text-muted">
                {projectName}
              </p>
            ) : null}
            <h1 id={titleId} className="text-display text-foreground">
              Settings
            </h1>
          </div>
        ) : projectName ? (
          <h1 id={titleId} className="min-w-0 break-words text-display text-foreground">{projectName}</h1>
        ) : (
          <div className={`h-8 w-56 max-w-full rounded bg-surface-muted ${loading ? "animate-pulse motion-reduce:animate-none" : ""}`} aria-hidden="true" />
        )}
      </div>
    </PageHeader>
  );
}

/** Focused settings use the same composition while their values load or change. */
export function ProductSettingsHeader({
  projectPath,
  projectName,
  label,
  description,
}: {
  projectPath: string;
  projectName?: string;
  label: string;
  description: string;
}) {
  return (
    <PageHeader
      back={<PageBackLink id="project-back-to-settings" to={`${projectPath}/settings`}>All settings</PageBackLink>}
    >
      <section id="project-form-header" className="px-1">
        {projectName ? (
          <p className="text-caption font-medium text-muted">{projectName}</p>
        ) : (
          <div className="h-4 w-36 max-w-full rounded bg-surface-muted" aria-hidden="true" />
        )}
        <h1 className="break-words text-display text-foreground">{label}</h1>
        <p className="mt-0.5 max-w-2xl text-body text-muted">{description}.</p>
      </section>
    </PageHeader>
  );
}
