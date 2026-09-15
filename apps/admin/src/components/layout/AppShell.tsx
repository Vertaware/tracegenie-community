import { MotionPage,MotionPresence,MotionSurface } from "@tracegenie/shared/motion";
import type { FeatureId,FeaturePlan } from "@tracegenie/shared";
import { Building2,ChevronUp,ListChecks,LogOut,Menu as MenuIcon,Settings,Shield,UserCircle,X,type LucideIcon } from "lucide-react";
import { useEffect,useRef,useState } from "react";
import { NavLink,Outlet,useLocation,useNavigate } from "react-router-dom";

import { copy } from "../../lib/copy";
import { isAdminFeatureDiscoverable } from "../../lib/featureExposure";
import { Menu,MenuContent,MenuItem,MenuTrigger } from "../ui/Menu";
import { TraceLogo } from "../ui/TraceLogo";
import {
type OrganizationDirectoryState,
type OrganizationOption
} from "./OrganizationSwitcher";

export { recordRecentOrganization } from "./OrganizationSwitcher";

type AppShellProps = {
  onSignOut: () => void;
  userName?: string;
  userId?: string;
  userRole?: string;
  platformRole?: string;
  plan?: FeaturePlan;
  organizations?: OrganizationOption[];
  organizationsState?: OrganizationDirectoryState;
  currentOrganizationId?: string;
  onOrganizationChange?: (organizationId: string) => void;
  onOrganizationsRetry?: () => void;
};

type NavigationItem = {
  featureId: FeatureId;
  to: string;
  icon: LucideIcon;
  label: string;
  end?: boolean;
};

export const APP_SHELL_FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function AppShell({
  onSignOut,
  userName,
  userId,
  userRole,
  platformRole,
  plan,
  organizations = [],
  organizationsState = "ready",
  currentOrganizationId,
  onOrganizationChange,
  onOrganizationsRetry,
}: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuOpenerRef = useRef<HTMLButtonElement>(null);
  const mobileMenuDrawerRef = useRef<HTMLDivElement>(null);
  const mainContentRef = useRef<HTMLElement>(null);
  const restoreMobileMenuFocusRef = useRef(false);
  const previousLocationPathRef = useRef(location.pathname);
  const isPlatformContext = /^\/platform(?:\/|$)/.test(location.pathname);
  const currentOrganizationName = organizations.find((organization) => organization.id === currentOrganizationId)?.name;
  const projectPath = location.pathname.match(/^\/projects\/[^/]+/)?.[0];
  const settingsPath = projectPath ? `${projectPath}/settings` : "/settings";
  const primaryNavItems: NavigationItem[] = ([
    { featureId: "route.issues", to: "/issues", icon: ListChecks, label: copy.nav.issues },
  ] satisfies NavigationItem[]).filter((item) => isAdminFeatureDiscoverable(item.featureId, userRole, platformRole, plan, currentOrganizationId));
  const settingsNavItems = ([
    ...(userRole === "ADMIN"
      ? [{ featureId: "route.settings" as const, to: settingsPath, icon: Settings, label: copy.nav.settings, end: false }]
      : []),
    ...(platformRole === "GLOBAL_ADMIN"
      ? [{ featureId: "route.platform" as const, to: "/platform", icon: Shield, label: copy.nav.platform, end: false }]
      : []),
  ] satisfies NavigationItem[]).filter((item) => isAdminFeatureDiscoverable(item.featureId, userRole, platformRole, plan, currentOrganizationId));
  
  const canOpenUserProfile = isAdminFeatureDiscoverable("route.user_detail", userRole, platformRole, plan, currentOrganizationId);
  const activePrimaryNavItems = isPlatformContext ? [] : primaryNavItems;
  const activeSettingsNavItems = isPlatformContext
    ? settingsNavItems.filter((item) => item.featureId === "route.platform")
    : settingsNavItems;
  useEffect(() => {
    const locationChanged = previousLocationPathRef.current !== location.pathname;
    previousLocationPathRef.current = location.pathname;
    if (!locationChanged || !mobileMenuOpen) return;
    restoreMobileMenuFocusRef.current = false;
    setMobileMenuOpen(false);
    window.requestAnimationFrame(() => mainContentRef.current?.focus());
  }, [location.pathname, mobileMenuOpen]);

  useEffect(() => {
    if (!mobileMenuOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const drawer = mobileMenuDrawerRef.current;
    drawer?.querySelector<HTMLElement>("button")?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        restoreMobileMenuFocusRef.current = true;
        setMobileMenuOpen(false);
        return;
      }

      if (event.key !== "Tab" || !drawer) {
        return;
      }

      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(APP_SHELL_FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const focusIsInside = document.activeElement instanceof Node && drawer.contains(document.activeElement);

      if (!focusIsInside) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    const desktopQuery = typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 768px)") : null;
    function onDesktopBreakpoint(event: MediaQueryListEvent) {
      if (!event.matches) return;
      restoreMobileMenuFocusRef.current = false;
      setMobileMenuOpen(false);
      window.requestAnimationFrame(() => mainContentRef.current?.focus());
    }

    document.addEventListener("keydown", onKeyDown);
    desktopQuery?.addEventListener("change", onDesktopBreakpoint);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      desktopQuery?.removeEventListener("change", onDesktopBreakpoint);
      if (restoreMobileMenuFocusRef.current) {
        mobileMenuOpenerRef.current?.focus();
      }
      restoreMobileMenuFocusRef.current = false;
    };
  }, [mobileMenuOpen]);

  return (
    <div id="admin-app-shell" className="min-h-screen bg-background text-foreground">
      <a
        id="admin-skip-to-content"
        href="#admin-main-content"
        className="fixed left-3 top-3 z-[100] -translate-y-24 rounded-lg bg-foreground px-4 py-2 text-label font-semibold text-background shadow-overlay transition-transform focus:translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        onClick={(event) => {
          event.preventDefault();
          mainContentRef.current?.focus();
        }}
      >
        Skip to main content
      </a>
      {/* ── Sidebar ── */}
      <aside
        id="admin-sidebar"
        className="tg-shell-rail fixed left-0 top-0 z-40 hidden h-screen w-[236px] flex-col border-r border-border/45 md:flex"
      >
        <div className="px-5 pb-4 pt-6">
          <TraceLogo variant="full" size="sm" />
        </div>

        <div id="community-project-context" className="px-4 pb-4"><p className="tg-rail-muted text-caption">Community</p><p className="tg-rail-strong mt-1 truncate text-label font-semibold">{currentOrganizationName ?? "Your project"}</p></div>

        <nav aria-label="Main navigation" className="flex-1 px-3">
          <div className="space-y-1">
            {activePrimaryNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `tg-shell-nav-item group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-label font-medium transition-colors duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] focus-visible:outline-2 focus-visible:outline-primary ${
                    isActive
                      ? "tg-shell-nav-item-active font-semibold"
                      : ""
                  }`
                }
              >
                {() => (
                  <span className="contents">
                    <item.icon
                      className="tg-nav-icon tg-shell-nav-icon shrink-0 transition-colors"
                      aria-hidden="true"
                    />
                    {item.label}
                  </span>
                )}
              </NavLink>
            ))}
            {activeSettingsNavItems.length > 0 ? (
              <div id="admin-settings-navigation-group" className="mt-1">
                <div className="space-y-1">
                  {activeSettingsNavItems.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        `tg-shell-nav-item group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-label font-medium transition-colors duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] focus-visible:outline-2 focus-visible:outline-primary ${
                          isActive
                            ? "tg-shell-nav-item-active font-semibold"
                            : ""
                        }`
                      }
                    >
                      {() => (
                        <span className="contents">
                          <item.icon
                            className="tg-nav-icon tg-shell-nav-icon shrink-0 transition-colors"
                            aria-hidden="true"
                          />
                          {item.label}
                        </span>
                      )}
                    </NavLink>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </nav>

        {/* User footer */}
        <div className="px-4 py-4">
          <Menu id="account-menu" dismissKey={location.key}>
            <MenuTrigger
              aria-label={`Account menu for ${userName ?? "Admin"}`}
              className="group flex w-full items-center gap-3 rounded-xl p-1 text-left transition-colors hover:bg-surface/70 focus-visible:outline-2 focus-visible:outline-primary"
            >
              <div className="tg-rail-avatar flex size-8 shrink-0 items-center justify-center rounded-xl text-caption font-semibold shadow-soft">
                {(userName ?? "A").charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="tg-rail-strong truncate text-label font-semibold">{userName ?? "Admin"}</p>
                <p className="tg-rail-muted truncate text-caption">
                  {platformRole === "GLOBAL_ADMIN" ? "Global admin" : userRole === "ADMIN" ? "Administrator" : "Triager"}
                </p>
              </div>
              <ChevronUp className="tg-rail-muted size-4 shrink-0 transition-transform group-aria-expanded:rotate-180" aria-hidden="true" />
            </MenuTrigger>
            <MenuContent data-side="top" className="tg-rail-menu absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-xl border p-1 shadow-overlay">
              {userId && canOpenUserProfile ? (
                <MenuItem
                  onSelect={() => {
                    navigate(`/users/${userId}`);
                    window.requestAnimationFrame(() => mainContentRef.current?.focus());
                  }}
                  className="tg-action-button flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-label font-medium text-foreground transition-colors hover:bg-surface-muted/60 focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <UserCircle className="size-4 text-muted" aria-hidden="true" />
                  Profile
                </MenuItem>
              ) : null}
              <MenuItem
                onSelect={onSignOut}
                className="tg-action-button flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-label font-medium text-foreground transition-colors hover:bg-surface-muted/60 focus-visible:outline-2 focus-visible:outline-primary"
              >
                <LogOut className="size-4 text-muted" aria-hidden="true" />
                {copy.nav.signOut}
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </aside>

      {/* ── Mobile top bar ── */}
      <header className="tg-shell-chrome fixed left-0 right-0 top-0 z-40 border-b border-border/35 px-4 pb-3 pt-3 md:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-border/35 bg-surface shadow-soft">
              <TraceLogo variant="icon" size="sm" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="tg-rail-strong truncate text-label font-semibold">TraceGenie</p>
                {organizations.length > 0 ? (
                  <span className="inline-flex size-5 items-center justify-center rounded-full bg-surface-muted text-muted">
                    <Building2 className="size-3" aria-hidden="true" />
                  </span>
                ) : null}
              </div>
              <p id="mobile-header-project-context" className="tg-rail-muted truncate text-caption">{currentOrganizationName ?? "Your project"}</p>
            </div>
          </div>
          <button
            ref={mobileMenuOpenerRef}
            type="button"
            onClick={() => {
              restoreMobileMenuFocusRef.current = false;
              setMobileMenuOpen(true);
            }}
            title={copy.common.menu}
            aria-label={copy.common.menu}
            className="tg-icon-button flex size-9 shrink-0 items-center justify-center rounded-full border border-border/35 bg-surface text-muted transition-colors hover:bg-surface-muted/70 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          >
            <MenuIcon className="size-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      <MotionPresence>
      {mobileMenuOpen ? (
        <MotionSurface kind="fade" className="fixed inset-0 z-50 md:hidden">
          <button
            id="mobile-navigation-scrim"
            type="button"
            aria-label={copy.common.closeMenu}
            className="absolute inset-0 bg-foreground/18 backdrop-blur-[2px]"
            onClick={() => {
              restoreMobileMenuFocusRef.current = true;
              setMobileMenuOpen(false);
            }}
          />
          <MotionSurface kind="drawer"
            ref={mobileMenuDrawerRef}
            className="tg-dialog-card tg-shell-rail absolute inset-y-0 right-0 flex w-[min(88vw,340px)] flex-col border-l border-border/35 px-4 pb-5 pt-4 shadow-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-navigation-drawer-title"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 id="mobile-navigation-drawer-title" className="tg-rail-strong text-label font-semibold">
                  TraceGenie
                </h2>
                <p className="tg-rail-muted mt-0.5 text-caption">{copy.nav.adminConsole}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  restoreMobileMenuFocusRef.current = true;
                  setMobileMenuOpen(false);
                }}
                title={copy.common.closeMenu}
                aria-label={copy.common.closeMenu}
                className="tg-icon-button tg-rail-icon-button flex size-9 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-primary"
              >
                  <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            <div id="mobile-community-project-context" className="mt-5"><p className="tg-rail-muted text-caption">Community</p><p className="tg-rail-strong mt-1 truncate text-label font-semibold">{currentOrganizationName ?? "Your project"}</p></div>

            <nav aria-label="Mobile navigation" className="mt-5 flex-1 overflow-y-auto">
              <div className="space-y-1.5">
                {activePrimaryNavItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `tg-mobile-card tg-shell-nav-item flex items-center gap-3 rounded-2xl px-3 py-3 text-label font-medium transition-colors ${
                        isActive
                          ? "tg-shell-nav-item-active"
                          : ""
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <span className="flex min-w-0 items-center gap-3">
                        <item.icon className="tg-shell-nav-icon size-4 shrink-0" aria-hidden="true" />
                        <span>{item.label}</span>
                      </span>
                    )}
                  </NavLink>
                ))}
              </div>

              {activeSettingsNavItems.length > 0 ? (
                <div id="mobile-admin-settings-navigation-group" className="mt-1.5">
                  <div className="space-y-1.5">
                    {activeSettingsNavItems.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.end}
                        className={({ isActive }) =>
                          `tg-mobile-card tg-shell-nav-item flex items-center gap-3 rounded-2xl px-3 py-3 text-label font-medium transition-colors ${
                            isActive
                              ? "tg-shell-nav-item-active"
                              : ""
                          }`
                        }
                      >
                        {({ isActive }) => (
                          <span className="flex min-w-0 items-center gap-3">
                            <item.icon className="tg-shell-nav-icon size-4 shrink-0" aria-hidden="true" />
                            <span>{item.label}</span>
                          </span>
                        )}
                      </NavLink>
                    ))}
                  </div>
                </div>
              ) : null}
            </nav>

            <div className="tg-rail-panel mt-5 rounded-2xl border p-3">
              <div className="flex items-center gap-3">
                <div className="tg-rail-avatar flex size-9 shrink-0 items-center justify-center rounded-2xl text-caption font-semibold shadow-soft">
                  {(userName ?? "A").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="tg-rail-strong truncate text-label font-semibold">{userName ?? "Admin"}</p>
                  <p className="tg-rail-muted truncate text-caption">
                    {platformRole === "GLOBAL_ADMIN" ? "Global admin" : userRole === "ADMIN" ? "Administrator" : "Triager"}
                  </p>
                </div>
              </div>
              <div id="mobile-account-actions" className="mt-3 grid gap-2">
                {userId && canOpenUserProfile ? (
                  <NavLink
                    to={`/users/${userId}`}
                    className="tg-action-button tg-rail-action flex w-full items-center justify-center gap-2 rounded-full border px-3 py-2 text-label font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <UserCircle className="size-4" aria-hidden="true" />
                    Profile
                  </NavLink>
                ) : null}
                <button
                  type="button"
                  onClick={onSignOut}
                  className="tg-action-button tg-rail-action flex w-full items-center justify-center gap-2 rounded-full border px-3 py-2 text-label font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <LogOut className="size-4" aria-hidden="true" />
                  {copy.nav.signOut}
                </button>
              </div>
            </div>
          </MotionSurface>
        </MotionSurface>
      ) : null}
      </MotionPresence>

      {/* ── Page content ── */}
      <main
        ref={mainContentRef}
        id="admin-main-content"
        tabIndex={-1}
        className="flex min-h-screen flex-col pt-[72px] focus:outline-none md:ml-[236px] md:pt-0"
      >
        <MotionPage path={location.pathname} className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </MotionPage>
      </main>
    </div>
  );
}
