import { GitBranch, Inbox, Lightbulb, Plug } from "lucide-react";
import { useState } from "react";
import { createRoot } from "react-dom/client";

import { Button } from "../src/components/ui/Button";
import { ListEmptyState, ListFilterEmptyState } from "../src/components/ui/DataTable";
import "../src/styles/index.css";

function RecoveryStatesHarness() {
  const [lastAction, setLastAction] = useState("No recovery action selected.");

  const record = (label: string) => () => setLastAction(`${label} selected.`);

  return (
    <main id="recovery-states-browser-harness" className="min-h-screen overflow-x-clip bg-surface px-3 py-5 sm:px-5 md:px-8 md:py-8">
      <section id="recovery-states-proof-surface" className="mx-auto w-full max-w-6xl">
        <header className="border-b border-border/40 pb-4">
          <p className="text-caption font-semibold text-primary">Operational recovery</p>
          <h1 className="mt-1 text-display text-foreground">Every empty state has a next step</h1>
          <p className="mt-1 max-w-2xl text-body text-muted">Actions use existing filters, routes, and setup controls.</p>
        </header>

        <p id="recovery-action-result" role="status" className="mt-4 border-l-2 border-primary px-3 py-2 text-label text-foreground">
          {lastAction}
        </p>

        <section id="recovery-state-grid" className="mt-5 grid gap-x-6 border-y border-border/35 md:grid-cols-2">
          <section id="recovery-products-filtered" className="border-b border-border/30 md:border-r">
            <ListFilterEmptyState
              title="No products match these filters"
              body="Clear the current filters to return to the full product list."
              actionLabel="Clear product filters"
              onAction={record("Clear product filters")}
            />
          </section>
          <section id="recovery-team-filtered" className="border-b border-border/30">
            <ListFilterEmptyState
              title="No team members match these filters"
              body="Clear the current filters to return to the full team list."
              actionLabel="Clear team filters"
              onAction={record("Clear team filters")}
            />
          </section>
          <section id="recovery-ideas-filtered" className="border-b border-border/30 md:border-r">
            <ListFilterEmptyState
              title="No ideas match this decision"
              body="Show all ideas without discarding the rest of the current view."
              actionLabel="Show all ideas"
              onAction={record("Show all ideas")}
            />
          </section>
          <section id="recovery-issues-empty" className="border-b border-border/30 md:border-r">
            <ListEmptyState
              icon={<Inbox className="size-5" />}
              title="Queue clear"
              body="Nothing is waiting on triage. New reports land here the moment they're captured."
              action={<Button tone="secondary" onClick={record("Open product setup")}>Open product setup</Button>}
            />
          </section>
          <section id="recovery-issues-empty-no-product-access" className="border-b border-border/30">
            <ListEmptyState
              icon={<Inbox className="size-5" />}
              title="Queue clear"
              body="Nothing is waiting on triage. New reports land here the moment they're captured."
            />
          </section>
          <section id="recovery-ideas-empty" className="border-b border-border/30">
            <ListEmptyState
              icon={<Lightbulb className="size-5" />}
              title="No ideas yet"
              body="Feature requests from the widget will appear here."
              action={<Button tone="secondary" onClick={record("Review incoming issues")}>Review incoming issues</Button>}
            />
          </section>
          <section id="recovery-releases-empty" className="border-b border-border/30 md:border-b-0 md:border-r">
            <ListEmptyState
              icon={<GitBranch className="size-5" />}
              title="No releases yet"
              body="New reports with release metadata will appear here."
              action={<Button tone="secondary" onClick={record("Review issues")}>Review issues</Button>}
            />
          </section>
          <section id="recovery-integrations-empty">
            <ListEmptyState
              icon={<Plug className="size-5" />}
              title="No integration health yet"
              body="Create a connection or webhook to start collecting operational health."
              action={<Button tone="secondary" onClick={record("Choose an integration")}>Choose an integration</Button>}
            />
          </section>
          <section id="recovery-integrations-mcp-empty" className="border-b border-border/30 md:border-r">
            <ListEmptyState
              icon={<Plug className="size-5" />}
              title="No connections yet"
              body="Create a scoped connection to let an AI client work against TraceGenie."
              action={<Button tone="secondary" onClick={record("Create MCP connection")}>Create MCP connection</Button>}
            />
          </section>
          <section id="recovery-integrations-slack-empty" className="border-b border-border/30">
            <ListEmptyState
              icon={<Plug className="size-5" />}
              title="No Slack connection yet"
              body="Connect Slack to send ticket updates to a channel."
              action={<Button tone="secondary" onClick={record("Configure Slack")}>Configure Slack</Button>}
            />
          </section>
          <section id="recovery-integrations-webhook-empty" className="md:col-span-2">
            <ListEmptyState
              icon={<Plug className="size-5" />}
              title="No webhooks yet"
              body="Create a webhook to deliver ticket events to another system."
              action={<Button tone="secondary" onClick={record("Set up first webhook")}>Set up first webhook</Button>}
            />
          </section>
        </section>
      </section>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Recovery states harness root is missing.");
createRoot(root).render(<RecoveryStatesHarness />);
