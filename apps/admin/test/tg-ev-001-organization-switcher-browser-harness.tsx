import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { AppShell, recordRecentOrganization } from "../src/components/layout/AppShell";
import type { OrganizationOption } from "../src/components/layout/OrganizationSwitcher";
import "../src/styles/index.css";

const duplicateOrganizations = Array.from({ length: 179 }, (_, index): OrganizationOption => ({
  id: `integration-service-${String(index + 1).padStart(4, "0")}`,
  name: "Integration service test",
  slug: `integration-service-${String(index + 1).padStart(4, "0")}`,
  status: index % 37 === 0 ? "SUSPENDED" : index % 9 === 0 ? "READ_ONLY" : "ACTIVE",
}));

const namedOrganizations = Array.from({ length: 820 }, (_, index): OrganizationOption => ({
  id: `organization-${String(index + 1).padStart(4, "0")}`,
  name: index === 3
    ? "Northwind Customer Experience and International Product Operations"
    : `Organization ${String(index + 1).padStart(4, "0")} Product Operations`,
  slug: `organization-${String(index + 1).padStart(4, "0")}`,
  status: index % 43 === 0 ? "READ_ONLY" : "ACTIVE",
}));

const organizations: OrganizationOption[] = [
  {
    id: "organization-current",
    name: "Acme Product Operations",
    slug: "acme-product-operations",
    status: "ACTIVE",
  },
  ...duplicateOrganizations,
  ...namedOrganizations,
];

window.localStorage.setItem(
  "tracegenie.recentOrganizationIds",
  JSON.stringify([
    "organization-0004",
    "integration-service-0002",
    "organization-0003",
    "integration-service-0010",
    "organization-0002",
  ]),
);

function ShellFixture() {
  const [organizationId, setOrganizationId] = useState("organization-current");

  return (
    <AppShell
      onSignOut={() => undefined}
      userName="Ada Reviewer"
      userId="user-proof"
      userRole="ADMIN"
      platformRole="GLOBAL_ADMIN"
      plan="TIER_3"
      organizations={organizations}
      organizationsState="ready"
      currentOrganizationId={organizationId}
      onOrganizationChange={(nextOrganizationId) => {
        recordRecentOrganization(organizationId);
        recordRecentOrganization(nextOrganizationId);
        setOrganizationId(nextOrganizationId);
      }}
    />
  );
}

function ShellContent() {
  return (
    <section id="tg-ev-001-browser-harness" aria-labelledby="tg-ev-001-browser-title" className="mx-auto max-w-5xl p-6">
      <p className="text-caption font-semibold text-primary">
        Organization workspace
      </p>
      <h1 id="tg-ev-001-browser-title" className="mt-1 text-display text-foreground">
        Product operations
      </h1>
      <p className="mt-2 max-w-2xl text-body text-muted">
        The shell fixture renders 1,000 organizations, including 179 duplicate fixture names and unavailable tenants.
      </p>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(
  <MemoryRouter initialEntries={["/home"]}>
    <Routes>
      <Route element={<ShellFixture />}>
        <Route path="*" element={<ShellContent />} />
      </Route>
    </Routes>
  </MemoryRouter>,
);

if (new URLSearchParams(window.location.search).get("open") === "true") {
  window.setTimeout(() => {
    document.querySelector<HTMLButtonElement>("header button[aria-label='Menu']")?.click();
    window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>("#mobile-app-shell-org-trigger")?.click();
    }, 100);
  }, 100);
}
