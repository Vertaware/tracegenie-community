import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { AppShell, recordRecentOrganization } from "../src/components/layout/AppShell";
import { Button } from "../src/components/ui/Button";
import { ConfirmDialog } from "../src/components/ui/ConfirmDialog";
import { Input, Textarea } from "../src/components/ui/Input";
import "../src/styles/index.css";

const DRAFT_KEY = "tracegenie.responsiveMatrixDraft";
const ORGANIZATION_KEY = "tracegenie.responsiveMatrixOrganization";
const organizations = [
  { id: "organization-alpha", name: "Acme Product Operations" },
  { id: "organization-beta", name: "Northwind Customer Experience" },
  { id: "organization-gamma", name: "Globex Platform Reliability" },
];

function readStoredValue(key: string, fallback: string) {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function MatrixSurface() {
  const location = useLocation();
  const [title, setTitle] = useState(() => readStoredValue(DRAFT_KEY, "Checkout confirmation intermittently fails"));
  const [notes, setNotes] = useState("The reporter reproduced this after returning from payment authorization.");
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    window.localStorage.setItem(DRAFT_KEY, title);
  }, [title]);

  return (
    <main id="responsive-matrix-surface" className="mx-auto min-h-screen w-full max-w-7xl px-3 pb-12 pt-5 sm:px-5 md:px-8 md:py-8">
      <header id="responsive-matrix-header" className="border-b border-border/40 pb-5">
        <p className="text-caption font-semibold text-primary">Responsive verification</p>
        <h1 className="mt-1 text-display text-foreground">Issue operations workspace</h1>
        <p id="responsive-current-route" className="mt-2 text-body text-muted">Current route: {location.pathname}</p>
      </header>

      <section id="responsive-density-section" className="mt-6" aria-labelledby="responsive-density-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="responsive-density-title" className="text-title text-foreground">Priority issues</h2>
            <p className="mt-1 text-body text-muted">Essential decisions remain visible at every supported width.</p>
          </div>
          <Button tone="secondary" onClick={() => setDialogOpen(true)}>Archive selected</Button>
        </div>
        <div id="responsive-table-region" className="mt-4 overflow-x-auto rounded-lg border border-border/40 bg-surface">
          <table id="responsive-density-table" className="w-full min-w-[680px] border-collapse text-left text-label">
            <thead className="bg-surface-muted/55 text-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">Issue</th>
                <th className="px-4 py-3 font-semibold">Severity</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Owner</th>
                <th className="px-4 py-3 font-semibold">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Checkout confirmation fails", "High", "Investigating", "Payments", "4 minutes ago"],
                ["Receipt email delayed", "Medium", "Triaged", "Messaging", "18 minutes ago"],
                ["Account switch loses filter", "Low", "New", "Platform", "31 minutes ago"],
              ].map((row) => (
                <tr key={row[0]} className="border-t border-border/35 text-foreground">
                  {row.map((cell) => <td key={cell} className="whitespace-nowrap px-4 py-3">{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="responsive-form-section" className="mt-8 border-t border-border/40 pt-6" aria-labelledby="responsive-form-title">
        <h2 id="responsive-form-title" className="text-title text-foreground">Triage note</h2>
        <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={(event) => event.preventDefault()}>
          <label className="grid gap-1.5 text-label font-medium text-foreground">
            Issue title
            <Input id="responsive-title-input" value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="grid gap-1.5 text-label font-medium text-foreground">
            Owner
            <select id="responsive-owner-select" className="tg-soft-input h-10 w-full rounded-lg border px-3 text-body text-foreground outline-none focus:border-primary focus:ring-3 focus:ring-primary/15" defaultValue="payments">
              <option value="payments">Payments</option>
              <option value="platform">Platform</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-label font-medium text-foreground md:col-span-2">
            Internal note
            <Textarea id="responsive-notes-input" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
          <div className="flex flex-wrap justify-end gap-2 md:col-span-2">
            <Button tone="secondary">Discard</Button>
            <Button type="submit">Save note</Button>
          </div>
        </form>
      </section>

      <ConfirmDialog
        isOpen={dialogOpen}
        title="Archive selected issues"
        description="Archived issues leave the active queue and remain available in audit history."
        confirmText="Archive issues"
        onCancel={() => setDialogOpen(false)}
        onConfirm={() => setDialogOpen(false)}
      />
    </main>
  );
}

function ShellFixture() {
  const [organizationId, setOrganizationId] = useState(() => readStoredValue(ORGANIZATION_KEY, organizations[0].id));

  const changeOrganization = (nextOrganizationId: string) => {
    recordRecentOrganization(nextOrganizationId);
    window.localStorage.setItem(ORGANIZATION_KEY, nextOrganizationId);
    setOrganizationId(nextOrganizationId);
  };

  return (
    <AppShell
      onSignOut={() => undefined}
      userName="Ada Reviewer"
      userId="user-proof"
      userRole="ADMIN"
      platformRole="GLOBAL_ADMIN"
      plan="TIER_3"
      organizations={organizations}
      currentOrganizationId={organizationId}
      onOrganizationChange={changeOrganization}
    />
  );
}

function App() {
  return (
    <MemoryRouter initialEntries={["/issues"]}>
      <Routes>
        <Route element={<ShellFixture />}>
          <Route path="*" element={<MatrixSurface />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Responsive matrix browser harness root is missing.");
createRoot(root).render(<App />);
