import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { AppShell } from "../src/components/layout/AppShell";
import "../src/styles/index.css";

function ShellFixture() {
  return (
    <AppShell
      onSignOut={() => undefined}
      userName="Ada Reviewer"
      userId="user-proof"
      userRole="ADMIN"
      platformRole="GLOBAL_ADMIN"
      plan="TIER_3"
      organizations={[
        { id: "organization-alpha", name: "Acme Product Operations" },
        { id: "organization-beta", name: "Northwind Customer Experience" },
      ]}
      currentOrganizationId="organization-alpha"
      onOrganizationChange={() => undefined}
    />
  );
}

function ShellContent() {
  return (
    <section id="tg69-shell-content" aria-labelledby="tg69-shell-title" className="mx-auto max-w-5xl p-6">
      <h1 id="tg69-shell-title" className="text-display text-foreground">Keyboard operations</h1>
      <p className="mt-2 text-body text-muted">Shell navigation and focus behavior use production components.</p>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(
  <MemoryRouter initialEntries={["/issues"]}>
    <Routes>
      <Route element={<ShellFixture />}>
        <Route path="*" element={<ShellContent />} />
      </Route>
    </Routes>
  </MemoryRouter>,
);
