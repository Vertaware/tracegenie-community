import { useQuery } from "@tanstack/react-query";
import {
widgetProjectConfigSchema,
type ProjectInstallDiagnosticsResponse,
type ProjectSummary,
} from "@tracegenie/shared";
import {
ArrowRight,
Bell,
Braces,
ChevronDown,
FileCheck2,
Inbox,
LayoutPanelTop,
Mail,
RefreshCw,
ShieldCheck,
SlidersHorizontal,
type LucideIcon
} from "lucide-react";
import { useState } from "react";
import { Link,useParams } from "react-router-dom";

import { Button } from "../../components/ui/Button";
import { ApiError,api } from "../../lib/api";
import { copy } from "../../lib/copy";
import { ProductWorkspaceHeader } from "./ProductWorkspaceHeader";

type ProductSettingsDirectoryPageProps = {
  organizationId?: string | null;
};

const directoryRowClassName = "tg-directory-reveal min-w-0";
const directoryLinkClassName = "tg-directory-card tg-card group flex min-h-32 h-full flex-col p-4 transition-[border-color,background-color,box-shadow] hover:border-primary/25 hover:bg-primary-light/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:p-5";
const directoryIconClassName = "tg-directory-icon size-5 text-primary";

function capitalize(value: string) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : "Default";
}

function installationStatus(project: ProjectSummary) {
  const originCount = project.allowedOrigins.length;
  return `${originCount} origin${originCount === 1 ? "" : "s"}`;
}

function projectDirectoryStatuses(project: ProjectSummary) {
  const configResult = widgetProjectConfigSchema.safeParse(project.widgetConfig ?? {});
  const config = configResult.success ? configResult.data : null;
  const evidenceCount = config
    ? [
        config.allowScreenshot,
        config.allowPointSelection,
        config.allowConsoleCapture,
        config.allowClientErrorContext,
        config.allowNetworkSummary,
      ].filter(Boolean).length
    : null;

  return {
    general: `${capitalize(project.defaultEnvironment)} environment`,
    installation: installationStatus(project),
    widget: project.isActive ? "Enabled" : "Disabled",
    evidence: evidenceCount === null
      ? null
      : `${evidenceCount} evidence source${evidenceCount === 1 ? "" : "s"} enabled`,
    notifications: `${project.notificationEmails.length} recipient${project.notificationEmails.length === 1 ? "" : "s"}`,
  };
}

function captureIsVerified(diagnostics: ProjectInstallDiagnosticsResponse | undefined) {
  if (!diagnostics) return false;
  const origin = diagnostics.proofs.find((proof) => proof.id === "origin");
  const session = diagnostics.proofs.find((proof) => proof.id === "session");
  const report = diagnostics.proofs.find((proof) => proof.id === "first_report");
  const installComplete = Boolean(
    origin
    && ["configured", "verified"].includes(origin.status)
    && session
    && ["configured", "verified"].includes(session.status),
  );
  return installComplete && report?.status === "verified";
}

function DirectoryStatus({ children }: { children: string | null }) {
  if (!children) return null;
  return (
    <span className="mt-auto pt-4">
      <span className="inline-flex rounded-full bg-surface-muted px-2.5 py-1 text-caption font-medium text-muted">
      {children}
      </span>
    </span>
  );
}

function DirectoryTile({
  id,
  href,
  label,
  description,
  icon: Icon,
  status,
}: {
  id: string;
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  status: string | null;
}) {
  return (
    <li id={id} className={directoryRowClassName}>
      <Link aria-label={label} to={href} className={directoryLinkClassName}>
        <span className="flex items-center justify-between gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary-light">
            <Icon className={directoryIconClassName} aria-hidden="true" />
          </span>
          <ArrowRight className="size-4 shrink-0 text-muted transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
        </span>
        <span className="mt-4 block text-title text-foreground">
          {label}
        </span>
        <span className="mt-1 block text-caption text-muted">
          {description}
        </span>
        <DirectoryStatus>
          {status}
        </DirectoryStatus>
      </Link>
    </li>
  );
}

export function ProductSettingsDirectoryPage({ organizationId }: ProductSettingsDirectoryPageProps = {}) {
  const { projectKey } = useParams<{ projectKey: string }>();
  const projectPath = `/projects/${encodeURIComponent(projectKey ?? "")}`;
  const projectQuery = useQuery({
    queryKey: ["product-settings-directory", organizationId, projectKey],
    queryFn: async () => {
      const result = await api.getProjects(organizationId);
      return result.projects.find((project) => project.key === projectKey) ?? null;
    },
    enabled: Boolean(projectKey),
    retry: false,
  });
  const diagnosticsQuery = useQuery({
    queryKey: ["product-settings-diagnostics", organizationId, projectKey],
    queryFn: () => api.getProjectInstallDiagnostics(projectKey ?? "", null, organizationId),
    enabled: Boolean(projectKey) && projectQuery.isSuccess && Boolean(projectQuery.data),
    retry: false,
  });
  const [afterCaptureDisclosureOpen, setAfterCaptureDisclosureOpen] = useState(false);

  if (projectQuery.isLoading) {
    return (
      <section
        id="product-settings-directory-loading"
        className="space-y-4"
        role="status"
        aria-label="Loading product settings"
      >
        <h1 className="sr-only">Loading product settings</h1>
        <ProductWorkspaceHeader projectPath={projectPath} activeSection="settings" loading />
        <div className="grid md:grid-cols-2">
          <div className="h-48 animate-pulse border-b border-border/30 bg-surface-muted/30 md:border-r" />
          <div className="h-48 animate-pulse border-b border-border/30 bg-surface-muted/30" />
        </div>
        <span className="sr-only">Loading product settings</span>
      </section>
    );
  }

  const permissionDenied = projectQuery.error instanceof ApiError
    && projectQuery.error.status === 403;

  if (permissionDenied) {
    return (
      <div className="space-y-5">
        <ProductWorkspaceHeader projectPath={projectPath} activeSection="settings" />
        <ProductDirectoryState kind="permission" />
      </div>
    );
  }

  if (projectQuery.isError && !projectQuery.data) {
    return (
      <div className="space-y-5">
        <ProductWorkspaceHeader projectPath={projectPath} activeSection="settings" />
        <ProductDirectoryState kind="error" onRetry={() => void projectQuery.refetch()} />
      </div>
    );
  }

  const project = projectQuery.data;
  if (!projectKey || !project) {
    return (
      <div className="space-y-5">
        <ProductWorkspaceHeader projectPath={projectPath} activeSection="settings" />
        <ProductDirectoryState kind="not-found" />
      </div>
    );
  }

  const statuses = projectDirectoryStatuses(project);
  const captureComplete = captureIsVerified(diagnosticsQuery.data);
  const diagnosticsReady = diagnosticsQuery.isSuccess || diagnosticsQuery.isError;
  const showAfterCaptureOpen = diagnosticsQuery.isError || captureComplete;
  const afterCaptureVisible = showAfterCaptureOpen || afterCaptureDisclosureOpen;
  const coreTiles = [
    {
      id: "product-settings-email",
      href: `${projectPath}/settings/email`,
      label: "Email",
      description: "Resend, SMTP, sender details, and a test email.",
      icon: Mail,
      status: null,
    },
    {
      id: "product-settings-general",
      href: `${projectPath}/settings/general`,
      label: "General",
      description: "Name, environment, key, and description.",
      icon: SlidersHorizontal,
      status: statuses.general,
    },
    {
      id: "product-settings-installation",
      href: `${projectPath}/settings/installation`,
      label: "Installation",
      description: "Origins, client secret, snippet, and verification.",
      icon: Braces,
      status: statuses.installation,
    },
    {
      id: "product-settings-widget",
      href: `${projectPath}/settings/widget`,
      label: "Widget",
      description: "Launcher appearance and behavior.",
      icon: LayoutPanelTop,
Mail,
      status: statuses.widget,
    },
    {
      id: "product-settings-evidence",
      href: `${projectPath}/settings/evidence`,
      label: "Evidence",
      description: "Capture sources and report fields.",
      icon: FileCheck2,
      status: statuses.evidence,
    },
  ];
  const afterCaptureTiles = [
    {
      id: "product-settings-notifications",
      href: `${projectPath}/settings/notifications`,
      label: "Notifications",
      description: "Recipients and product email branding.",
      icon: Bell,
      status: statuses.notifications,
    },
    {
      id: "product-settings-privacy",
      href: `${projectPath}/settings/privacy`,
      label: "Privacy",
      description: "Retention, redaction, and disclosure.",
      icon: ShieldCheck,
      status: null,
    },
    ...[],
  ];

  return (
    <section id="product-settings-directory" className="space-y-4" aria-labelledby="product-settings-directory-title">
      <ProductWorkspaceHeader
        id="product-settings-directory-header"
        titleId="product-settings-directory-title"
        backLinkId="product-settings-back-link"
        projectPath={projectPath}
        projectName={project.name}
        activeSection="settings"
      />

      {projectQuery.isFetching && !projectQuery.isError ? (
        <p
          id="product-settings-directory-refreshing"
          className="tg-panel px-4 py-3 text-label text-muted"
          role="status"
          aria-label="Refreshing saved settings"
        >
          Refreshing saved settings.
        </p>
      ) : null}

      {projectQuery.isError ? (
        <div
          id="product-settings-directory-stale"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning-200/60 bg-warning-50 px-4 py-3"
          role="status"
          aria-label="Saved settings may be out of date"
        >
          <p className="text-label text-warning-800">
            Showing the last saved settings. Current changes could not be refreshed.
          </p>
          <Button tone="secondary" className="min-h-11" onClick={() => void projectQuery.refetch()}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Retry refresh
          </Button>
        </div>
      ) : null}

      <section aria-labelledby="product-settings-capture-title">
        <div className="px-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="product-settings-capture-title" className="text-title text-foreground">Setup & capture</h2>
            <span className={`inline-flex rounded-full px-2 py-0.5 text-caption font-semibold ${project.isActive ? "bg-success-50 text-success-700" : "bg-surface-muted text-muted"}`}>
              {project.isActive ? "Active" : "Inactive"}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-body text-muted">
            The essentials that control where reports come from and what they contain.
          </p>
        </div>
        <ul id="product-settings-directory-links" className="mt-3 grid gap-3 sm:grid-cols-2">
          {coreTiles.map((tile) => (
            <DirectoryTile
              key={tile.id}
              id={tile.id}
              href={tile.href}
              label={tile.label}
              description={tile.description}
              icon={tile.icon}
              status={tile.status}
            />
          ))}
        </ul>
      </section>

      {diagnosticsReady ? (
        <section
          id="product-settings-after-capture"
          className="space-y-3"
          aria-labelledby="product-settings-after-capture-title"
        >
          {showAfterCaptureOpen ? (
            <div id="product-settings-after-capture-open">
              <h2 id="product-settings-after-capture-title" className="px-1 text-title text-foreground">
                {copy.projects.settingsAfterCaptureTitle}
              </h2>
              <p className="mt-1 max-w-2xl px-1 text-body text-muted">
                {copy.projects.settingsAfterCaptureBody}
              </p>
              <ul id="product-settings-after-capture-links" className="mt-3 grid gap-3 sm:grid-cols-2">
                {afterCaptureTiles.map((tile) => (
                  <DirectoryTile
                    key={tile.id}
                    id={tile.id}
                    href={tile.href}
                    label={tile.label}
                    description={tile.description}
                    icon={tile.icon}
                    status={tile.status}
                  />
                ))}
              </ul>
            </div>
          ) : (
            <details
              id="product-settings-after-capture-disclosure"
              className="tg-card group overflow-hidden"
              open={afterCaptureDisclosureOpen}
              onToggle={(event) => setAfterCaptureDisclosureOpen(event.currentTarget.open)}
            >
              <summary className="grid min-h-11 cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 p-5 text-foreground outline-none hover:bg-primary-light/20 focus-visible:outline-2 focus-visible:outline-primary sm:p-6 [&::-webkit-details-marker]:hidden">
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary-light text-primary">
                  <ShieldCheck className="size-5" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-title">{copy.projects.settingsAfterCaptureSummary}</span>
                  <span className="mt-1 block text-caption text-muted">Manage delivery and privacy.</span>
                </span>
                <ChevronDown className="size-4 text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              {afterCaptureVisible ? (
                <div id="product-settings-after-capture-disclosure-body" className="px-4 pb-4 sm:px-5 sm:pb-5">
                  <p id="product-settings-after-capture-title" className="text-title text-foreground">
                    {copy.projects.settingsAfterCaptureTitle}
                  </p>
                  <p className="mt-1 max-w-2xl text-body text-muted">
                    {copy.projects.settingsAfterCaptureBody}
                  </p>
                  <ul id="product-settings-after-capture-links" className="mt-4 grid gap-3 sm:grid-cols-2">
                    {afterCaptureTiles.map((tile) => (
                      <DirectoryTile
                        key={tile.id}
                        id={tile.id}
                        href={tile.href}
                        label={tile.label}
                        description={tile.description}
                        icon={tile.icon}
                        status={tile.status}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}
            </details>
          )}
        </section>
      ) : null}
    </section>
  );
}

function ProductDirectoryState({
  kind,
  onRetry,
}: {
  kind: "error" | "not-found" | "permission";
  onRetry?: () => void;
}) {
  const isError = kind === "error";
  const isPermission = kind === "permission";

  return (
    <section
      id={`product-settings-directory-${kind}`}
      className="flex min-h-72 flex-col items-center justify-center border-y border-border/35 px-5 py-12 text-center"
      role={isError || isPermission ? "alert" : "status"}
    >
      <Inbox className="size-8 text-muted" aria-hidden="true" />
      <h1 className="mt-4 text-title text-foreground">
        {isPermission
          ? "Product settings unavailable"
          : isError
            ? "Couldn't load product settings"
            : "Product not found"}
      </h1>
      <p className="mt-2 max-w-md text-body text-muted">
        {isPermission
          ? "You don't have permission to view this product's settings."
          : isError
          ? "The product configuration could not be loaded. Retry the request."
          : "This product may have been removed or may not belong to the current organization."}
      </p>
      {isError && onRetry ? (
        <Button className="mt-5" onClick={onRetry}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Retry
        </Button>
      ) : null}
    </section>
  );
}
