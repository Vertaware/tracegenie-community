import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import type { FeatureId,FeaturePlan } from "@tracegenie/shared";
import { AlertCircle } from "lucide-react";
import { lazy,Suspense,useCallback,useEffect,useRef,useState,type ReactElement } from "react";
import { Link,Navigate,Route,Routes,useLocation,useNavigate,useParams } from "react-router-dom";

import { useAdminExitActions } from "../components/guards/AdminFormExitGuard";
import { AppShell } from "../components/layout/AppShell";
import { InstallationEntry } from "../features/auth/InstallationEntry";
import { LoginPage } from "../features/auth/LoginPage";
import { ADMIN_SESSION_EXPIRED_EVENT,api,ApiError } from "../lib/api";
import { copy } from "../lib/copy";
import {
isAdminFeatureDiscoverable,
isPublicFeatureDiscoverable,
recordHiddenFeatureExposure,
} from "../lib/featureExposure";
import { useIdleTimer } from "../lib/useIdleTimer";

import { AcceptInvitePage } from "../features/auth/AcceptInvitePage";
import { AuthShell } from "../features/auth/AuthShell";
import { ForgotPasswordPage } from "../features/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "../features/auth/ResetPasswordPage";

import { getLegacyProductSectionRedirect } from "../features/projects/projectSectionRoutes";

import { ReporterPortalPage } from "../features/reporter/ReporterPortalPage";

const IssuesPage = lazy(() => import("../features/issues/IssuesPage").then((module) => ({ default: module.IssuesPage })));
const IssueDetailPage = lazy(() => import("../features/issues/IssueDetailPage").then((module) => ({ default: module.IssueDetailPage })));

const ProjectFormPage = lazy(() => import("../features/projects/ProjectFormPage").then((module) => ({ default: module.ProjectFormPage })));
const EmailSettingsPage = lazy(() => import("../features/settings/EmailSettingsPage").then((module) => ({ default: module.EmailSettingsPage })));
const ProductSettingsDirectoryPage = lazy(() => import("../features/projects/ProductSettingsDirectoryPage").then((module) => ({ default: module.ProductSettingsDirectoryPage })));

const UserListPage = lazy(() => import("../features/users/UserListPage").then((module) => ({ default: module.UserListPage })));
const UserFormPage = lazy(() => import("../features/users/UserFormPage").then((module) => ({ default: module.UserFormPage })));
const InviteMemberPage = lazy(() => import("../features/users/InviteMemberPage").then((module) => ({ default: module.InviteMemberPage })));

function PageLoading() {
  return (
    <section
      id="admin-route-loading"
      className="flex min-h-[60vh] items-center justify-center px-4 text-label text-muted"
      role="status"
    >
      Loading page...
    </section>
  );
}

type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  platformRole?: string;
};

type LoginMutationVariables = {
  generation: number;
  signal: AbortSignal;
  values: { email: string; password: string };
};

const SESSION_RETURN_PATH_KEY = "tracegenie.adminSessionReturnPath";
const NON_RETURN_PATHS = new Set([
  "/",
  "/login",
  "/signup",
  "/setup",
  "/forgot-password",
  "/reset-password",
  "/accept-invite",
  "/reporter",
]);

export function getSafeAdminReturnPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  const parsed = new URL(value, "https://tracegenie.local");
  if (parsed.origin !== "https://tracegenie.local" || NON_RETURN_PATHS.has(parsed.pathname)) return null;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function readStoredReturnPath() {
  return getSafeAdminReturnPath(window.sessionStorage.getItem(SESSION_RETURN_PATH_KEY));
}

export function NotFoundPage({ destination, destinationLabel, featureId, publicEntry = false }: {
  destination?: string | null;
  destinationLabel?: string;
  featureId?: FeatureId;
  publicEntry?: boolean;
}) {
  useEffect(() => {
    if (featureId) {
      recordHiddenFeatureExposure("feature.hidden_route_requested", featureId);
    }
  }, [featureId]);

  if (publicEntry) {
    return (
      <AuthShell
        idPrefix="public-not-found"
        pageId="admin-not-found-page"
        cardId="admin-not-found-content"
        title="Page not found"
        description="This public page is unavailable. Use the safe destination below to continue."
        trustDescription="TraceGenie does not reveal organization, product, or report details from an unavailable public link."
      >
        <div id="public-not-found-recovery" className="mt-6">
          <p className="text-label font-semibold text-muted">404</p>
          {destination && destinationLabel ? (
            <Link
              id="admin-not-found-recovery-link"
              to={destination}
              data-tg-primary-target="true"
              className="tg-action-button mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-primary px-4 text-label font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {destinationLabel}
            </Link>
          ) : null}
        </div>
      </AuthShell>
    );
  }

  return (
    <section id="admin-not-found-page" className="flex min-h-[60vh] items-center justify-center px-4 py-12 text-center">
      <div id="admin-not-found-content" className="max-w-md">
        <p className="text-label font-semibold text-muted">404</p>
        <h1 className="mt-2 text-title text-foreground">Page not found</h1>
        <p className="mt-2 text-body text-muted">This page is unavailable or you do not have access.</p>
        {destination && destinationLabel ? (
          <Link
            id="admin-not-found-recovery-link"
            to={destination}
            data-tg-primary-target="true"
            className="tg-action-button mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 text-label font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-primary"
          >
            {destinationLabel}
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function ProductOverviewRoute({ organizationId }: { organizationId?: string | null }) {
  const { projectKey } = useParams<{ projectKey: string }>();
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  if (projectKey && search.has("section")) {
    return (
      <Navigate
        to={getLegacyProductSectionRedirect(projectKey, {
          search: location.search,
          hash: location.hash,
        })}
        replace
      />
    );
  }
  return <ProjectFormPage organizationId={organizationId} canonicalSection="overview" />;
}

function SingleProjectRoute({ organizationId, settings = false }: { organizationId?: string | null; settings?: boolean }) {
  const projects = useQuery({ queryKey: ["community-project", organizationId], queryFn: () => api.getProjects(organizationId), enabled: Boolean(organizationId) });
  if (projects.isError) return <section id="project-load-error" className="py-8 text-body"><p>Could not load this project.</p><button type="button" className="tg-inline-link" onClick={() => void projects.refetch()}>Retry</button></section>;
  const project = projects.data?.projects[0];
  return project ? <Navigate to={`/projects/${encodeURIComponent(project.key)}${settings ? "/settings" : ""}`} replace /> : <PageLoading />;
}

export function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [currentOrganizationId, setCurrentOrganizationId] = useState<string | null>(() =>
    window.localStorage.getItem("tracegenie.currentOrganizationId"),
  );
  const [sessionReturnPath, setSessionReturnPath] = useState<string | null>(readStoredReturnPath);
  const [sessionExpired, setSessionExpired] = useState(() => Boolean(readStoredReturnPath()));
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const isPlatformRoute = /^\/platform(?:\/|$)/.test(location.pathname);
  const { requestExit } = useAdminExitActions();
  const authActionLockRef = useRef<symbol | null>(null);
  const authRequestRef = useRef<AbortController | null>(null);
  const authRouteRef = useRef({ path: location.pathname, generation: 0 });
  const locationRef = useRef(location);
  locationRef.current = location;

  if (authRouteRef.current.path !== location.pathname) {
    authRouteRef.current = {
      path: location.pathname,
      generation: authRouteRef.current.generation + 1,
    };
  }

  const clearSessionRecovery = useCallback(() => {
    window.sessionStorage.removeItem(SESSION_RETURN_PATH_KEY);
    setSessionReturnPath(null);
    setSessionExpired(false);
  }, []);

  const beginSessionRecovery = useCallback(() => {
    const current = locationRef.current;
    const returnPath = getSafeAdminReturnPath(`${current.pathname}${current.search}${current.hash}`)
      ?? readStoredReturnPath();
    if (returnPath) {
      window.sessionStorage.setItem(SESSION_RETURN_PATH_KEY, returnPath);
    }
    setSessionReturnPath(returnPath);
    setSessionExpired(true);
    api.invalidateAdminSession();
    api.setActiveOrganizationId(null);
    queryClient.clear();
    setUser(null);
    if (current.pathname !== "/login") {
      navigate("/login", { replace: true });
    }
  }, [navigate, queryClient]);
  const beginSessionRecoveryRef = useRef(beginSessionRecovery);
  beginSessionRecoveryRef.current = beginSessionRecovery;

  useEffect(() => {
    const onSessionExpired = () => beginSessionRecovery();
    window.addEventListener(ADMIN_SESSION_EXPIRED_EVENT, onSessionExpired);
    return () => window.removeEventListener(ADMIN_SESSION_EXPIRED_EVENT, onSessionExpired);
  }, [beginSessionRecovery]);

  useEffect(() => {
    let cancelled = false;
    void api
      .getMe()
      .then(({ user: sessionUser }) => {
        if (!cancelled) {
          const storedReturnPath = readStoredReturnPath();
          api.markAdminSessionAuthenticated();
          api.setActiveOrganizationId(/^\/platform(?:\/|$)/.test(locationRef.current.pathname) ? null : currentOrganizationId);
          window.sessionStorage.removeItem(SESSION_RETURN_PATH_KEY);
          setSessionReturnPath(null);
          setSessionExpired(false);
          setUser(sessionUser);
          if (storedReturnPath && locationRef.current.pathname === "/login") {
            navigate(storedReturnPath, { replace: true });
          }
        }
      })
      .catch((error) => {
        if (!cancelled) {
          if (error instanceof ApiError && error.status === 401 && getSafeAdminReturnPath(
            `${locationRef.current.pathname}${locationRef.current.search}${locationRef.current.hash}`,
          )) {
            beginSessionRecoveryRef.current();
          } else {
            setUser(null);
          }
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSessionReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const loginMutation = useMutation({
    mutationFn: (submitted: LoginMutationVariables) => api.login(
      submitted.values.email,
      submitted.values.password,
      submitted.signal,
    ),
    onSuccess: (session, submitted) => {
      if (submitted.signal.aborted || submitted.generation !== authRouteRef.current.generation) return;
      const returnPath = sessionReturnPath;
      clearSessionRecovery();
      api.markAdminSessionAuthenticated();
      api.setActiveOrganizationId(currentOrganizationId);
      setUser(session.user);
      navigate(returnPath ?? "/", { replace: true });
    },
  });

  useEffect(() => {
    authRequestRef.current?.abort();
    authRequestRef.current = null;
    authActionLockRef.current = null;
    loginMutation.reset();
    
  }, [location.pathname]);

  const runLogin = async (values: { email: string; password: string }) => {
    if (authActionLockRef.current !== null) return;
    const lock = Symbol("login");
    const controller = new AbortController();
    authActionLockRef.current = lock;
    authRequestRef.current = controller;
    try {
      await loginMutation.mutateAsync({
        generation: authRouteRef.current.generation,
        signal: controller.signal,
        values,
      });
    } finally {
      if (authActionLockRef.current === lock) authActionLockRef.current = null;
      if (authRequestRef.current === controller) authRequestRef.current = null;
    }
  };

  const organizationsQuery = useQuery({
    queryKey: ["organizations"],
    queryFn: api.getOrganizations,
    enabled: Boolean(user),
  });

  useEffect(() => {
    const organizations = organizationsQuery.data?.organizations ?? [];
    if (!currentOrganizationId && organizations.length > 0) {
      setCurrentOrganizationId(organizations[0].id);
    }
    if (currentOrganizationId && organizations.length > 0 && !organizations.some((organization) => organization.id === currentOrganizationId)) {
      // Access loss cannot leave a revoked tenant active; org-keyed forms clear when this identity changes.
      api.setActiveOrganizationId(organizations[0].id);
      setCurrentOrganizationId(organizations[0].id);
    }
  }, [currentOrganizationId, organizationsQuery.data?.organizations]);

  useEffect(() => {
    api.setActiveOrganizationId(isPlatformRoute ? null : currentOrganizationId);
    if (currentOrganizationId) {
      window.localStorage.setItem("tracegenie.currentOrganizationId", currentOrganizationId);
    }
  }, [currentOrganizationId, isPlatformRoute]);

  const forceSignOut = useCallback(() => {
    clearSessionRecovery();
    api.invalidateAdminSession();
    api.setActiveOrganizationId(null);
    queryClient.clear();
    setUser(null);
    navigate("/login", { replace: true });
    void api.logout().catch(() => undefined);
  }, [clearSessionRecovery, navigate, queryClient]);
  const handleSignOut = useCallback(() => {
    requestExit("internal-navigation", () => {
      forceSignOut();
    });
  }, [forceSignOut, requestExit]);

  // Auto sign-out after 4 hours of complete inactivity.
  useIdleTimer(forceSignOut, 4 * 60 * 60 * 1000);

  if (!sessionReady) {
    return (
      <div id="admin-session-loading" className="flex min-h-screen items-center justify-center bg-background px-4">
        <p className="text-body text-muted">{copy.session.checking}</p>
      </div>
    );
  }

  const publicRecoveryRoute = ([
    { featureId: "route.login", path: "/login", label: "Go to sign in" },
    { featureId: "route.reporter", path: "/reporter", label: "Go to reported items" },
    { featureId: "route.forgot_password", path: "/forgot-password", label: "Go to password recovery" },
  ] satisfies Array<{ featureId: FeatureId; path: string; label: string }>).find((candidate) => (
    isPublicFeatureDiscoverable(candidate.featureId)
  ));
  const publicFeatureElement = (featureId: FeatureId, element: ReactElement) => (
    isPublicFeatureDiscoverable(featureId)
      ? element
      : (
        <NotFoundPage
          destination={publicRecoveryRoute?.path}
          destinationLabel={publicRecoveryRoute?.label}
          publicEntry
        />
      )
  );

  if (!user) {
    const publicNotFoundRecovery = location.pathname.startsWith("/reporter")
      && isPublicFeatureDiscoverable("route.reporter")
      ? { path: "/reporter", label: "Go to reporter access" }
      : publicRecoveryRoute;
    
    const loginInvalidCredentials = loginMutation.error instanceof ApiError
      && (
        loginMutation.error.status === 401
        || loginMutation.error.code === "auth.invalid_credentials"
      );
    const loginPage = publicFeatureElement("route.login", (
      <LoginPage
        onLogin={async (values) => {
          await runLogin(values);
        }}
        feedback={loginMutation.isError ? (
          <section
            id="login-mutation-recovery"
            className="flex items-start gap-2.5 rounded-lg bg-danger-50 px-3 py-2.5"
            role="alert"
            aria-live="assertive"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger-700" aria-hidden="true" />
            <p className="text-label font-semibold text-danger-700">
              {loginInvalidCredentials
                ? copy.login.invalidCredentials
                : copy.login.unavailable}
            </p>
          </section>
        ) : null}
        loading={loginMutation.isPending}
        sessionNotice={sessionExpired ? copy.session.expired : null}
      />
    ));
    const installationEntry = <InstallationEntry login={loginPage} onComplete={(owner) => {
      api.markAdminSessionAuthenticated();
      queryClient.clear();
      setUser(owner);
      navigate("/projects/community/settings/email?setup=1", { replace: true });
    }} />;
    return (
      <Routes>
        <Route path="/accept-invite" element={publicFeatureElement("route.accept_invite", (
          <AcceptInvitePage
            onAccepted={(session) => {
              api.markAdminSessionAuthenticated();
              setUser(session.user);
            }}
          />
        ))} />
        
        <Route path="/forgot-password" element={publicFeatureElement("route.forgot_password", <ForgotPasswordPage />)} />
        <Route path="/reset-password" element={publicFeatureElement("route.reset_password", (
          <ResetPasswordPage
            onReset={(session) => {
              api.markAdminSessionAuthenticated();
              setUser(session.user);
            }}
          />
        ))} />
        <Route path="/reporter" element={publicFeatureElement("route.reporter", <ReporterPortalPage />)} />
        <Route path="/" element={installationEntry} />
        <Route path="/login" element={installationEntry} />
        <Route path="/setup" element={installationEntry} />
        <Route
          path="*"
          element={(
            <NotFoundPage
              destination={publicNotFoundRecovery?.path}
              destinationLabel={publicNotFoundRecovery?.label}
              publicEntry
            />
          )}
        />
      </Routes>
    );
  }

  const organizations = organizationsQuery.data?.organizations ?? [];
  const currentOrganizationName = organizations.find((organization) => organization.id === currentOrganizationId)?.name ?? null;
  const currentPlan = (organizations.find((organization) => organization.id === currentOrganizationId)?.plan ?? "FREE") as FeaturePlan;
  
  const firstDiscoverableRoute = ([
    { featureId: "route.issues", path: "/issues", label: "Go to issues" },
    { featureId: "route.projects", path: "/projects", label: "Go to products" },
    { featureId: "route.settings", path: "/settings", label: "Go to settings" },
  ] satisfies Array<{ featureId: FeatureId; path: string; label: string }>).find((candidate) => (
    isAdminFeatureDiscoverable(candidate.featureId, user.role, user.platformRole, currentPlan, currentOrganizationId ?? undefined, user.id)
  ));
  const featureElement = (featureId: FeatureId, element: ReactElement) => (
    isAdminFeatureDiscoverable(featureId, user.role, user.platformRole, currentPlan, currentOrganizationId ?? undefined, user.id)
      ? element
      : (
        <NotFoundPage
          destination={firstDiscoverableRoute?.path}
          destinationLabel={firstDiscoverableRoute?.label}
          featureId={featureId}
        />
      )
  );
  const adminRoutes = user.role === "ADMIN"
    ? [
        <Route key="projects" path="/projects" element={<SingleProjectRoute organizationId={currentOrganizationId} />} />,
        ...[],
        <Route key="project-detail" path="/projects/:projectKey" element={featureElement("route.project_detail", <ProductOverviewRoute organizationId={currentOrganizationId} />)} />,
        <Route key="project-settings" path="/projects/:projectKey/settings" element={featureElement("route.project_detail", <ProductSettingsDirectoryPage organizationId={currentOrganizationId} />)} />,
        <Route key="project-settings-general" path="/projects/:projectKey/settings/general" element={featureElement("route.project_detail", <ProjectFormPage organizationId={currentOrganizationId} canonicalSection="overview" settingsDestination="general" />)} />,
        <Route key="project-settings-installation" path="/projects/:projectKey/settings/installation" element={featureElement("route.project_detail", <ProjectFormPage organizationId={currentOrganizationId} canonicalSection="install" settingsDestination="installation" />)} />,
        <Route key="project-settings-widget" path="/projects/:projectKey/settings/widget" element={featureElement("route.project_detail", <ProjectFormPage organizationId={currentOrganizationId} canonicalSection="capture" settingsDestination="widget" />)} />,
        <Route key="project-settings-evidence" path="/projects/:projectKey/settings/evidence" element={featureElement("route.project_detail", <ProjectFormPage organizationId={currentOrganizationId} canonicalSection="capture" settingsDestination="evidence" />)} />,
        ...[],
        ...[],
        <Route key="project-settings-email" path="/projects/:projectKey/settings/email" element={<EmailSettingsPage adminEmail={user.email} organizationId={currentOrganizationId} />} />,
        <Route key="project-settings-notifications" path="/projects/:projectKey/settings/notifications" element={featureElement("route.project_detail", <ProjectFormPage organizationId={currentOrganizationId} canonicalSection="notifications" settingsDestination="notifications" />)} />,
        <Route key="project-settings-privacy" path="/projects/:projectKey/settings/privacy" element={featureElement("route.project_detail", <ProjectFormPage organizationId={currentOrganizationId} canonicalSection="privacy" settingsDestination="privacy" />)} />,
        ...[],
        ...[],
        ...[],
        ...[],
        ...[],
        ...[],
        ...[],
        ...[],
        <Route key="users" path="/users" element={featureElement("route.users", <UserListPage organizationId={currentOrganizationId} organizationName={currentOrganizationName} />)} />,
        <Route key="users-new" path="/users/new" element={featureElement("route.user_invite", <InviteMemberPage organizationId={currentOrganizationId} organizationName={currentOrganizationName} />)} />,
        <Route key="settings" path="/settings" element={<SingleProjectRoute organizationId={currentOrganizationId} settings />} />,
        ...[],
        ...[],
      ]
    : [];

  return (
    <div id="admin-authenticated-app" className="min-h-screen">
      <Suspense fallback={<PageLoading />}>
        <Routes>
        <Route
          element={(
            <AppShell
              userName={user.name}
              userId={user.id}
              userRole={user.role}
              platformRole={user.platformRole}
              plan={currentPlan}
              organizations={organizations}
              organizationsState={
                organizationsQuery.isPending
                  ? "loading"
                  : organizationsQuery.isError
                    ? organizations.length > 0
                      ? "stale"
                      : "error"
                    : organizationsQuery.isFetching
                      ? "refreshing"
                      : "ready"
              }
              currentOrganizationId={currentOrganizationId ?? undefined}
              onOrganizationsRetry={() => {
                void organizationsQuery.refetch();
              }}
              
              onSignOut={handleSignOut}
            />
          )}
        >
          <Route
            path="/"
            element={firstDiscoverableRoute
              ? <Navigate to={firstDiscoverableRoute.path} replace />
              : <NotFoundPage />}
          />
          
          
          
          
          <Route
            path="/issues"
            element={featureElement("route.issues", (
              <IssuesPage
                organizationId={currentOrganizationId}
                canOpenProductSetup={user.role === "ADMIN" && isAdminFeatureDiscoverable("route.projects", user.role, user.platformRole, currentPlan, currentOrganizationId ?? undefined, user.id)}
              />
            ))}
          />
          <Route path="/issues/:feedbackId" element={featureElement("route.issue_detail", <IssueDetailPage />)} />
          
          
          
          
          
          <Route
            path="/users/:id"
            element={featureElement("route.user_detail", <UserFormPage organizationId={currentOrganizationId} organizationName={currentOrganizationName} currentUserId={user.id} />)}
          />
          {adminRoutes}
          
          
        </Route>
        <Route path="/accept-invite" element={publicFeatureElement("route.accept_invite", (
          <AcceptInvitePage
            onAccepted={(session) => {
              api.markAdminSessionAuthenticated();
              setUser(session.user);
            }}
          />
        ))} />
        <Route path="/reporter" element={publicFeatureElement("route.reporter", <ReporterPortalPage />)} />
        <Route
          path="*"
          element={(
            <NotFoundPage
              destination={firstDiscoverableRoute?.path}
              destinationLabel={firstDiscoverableRoute?.label}
            />
          )}
        />
        </Routes>
      </Suspense>
      
    </div>
  );
}
