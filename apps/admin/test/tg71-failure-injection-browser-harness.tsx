import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import { Button } from "../src/components/ui/Button";
import "../src/styles/index.css";
import { failureInjectionCases, type FailureGroup } from "./tg71-failure-injection-model";

const group = new URLSearchParams(window.location.search).get("group") as FailureGroup | null;
const visibleGroup: FailureGroup = group && ["network", "authorization", "validation", "concurrency", "delivery"].includes(group)
  ? group
  : "network";

function FailureInjectionHarness() {
  const cases = useMemo(() => failureInjectionCases.filter((entry) => entry.group === visibleGroup), []);
  const [result, setResult] = useState("Select a row to reveal its executable production evidence.");

  return (
    <main id="tg71-failure-injection-harness" className="min-h-screen overflow-x-clip bg-surface px-3 py-5 sm:px-6 md:px-8 md:py-8">
      <section id="tg71-proof-surface" className="mx-auto w-full max-w-6xl">
        <header id="tg71-proof-header" className="border-b border-border/50 pb-5">
          <p className="text-caption font-semibold uppercase text-primary">Release resilience evidence</p>
          <h1 className="mt-1 text-display text-foreground">Production failure coverage</h1>
          <p className="mt-2 max-w-3xl text-body text-muted">
            Focused tests inject each failure into a production component, route, or service. This registry summarizes those executable checks; it is not a simulated product screen.
          </p>
          <div className="mt-4 flex flex-wrap gap-2" aria-label="Matrix coverage summary">
            <span className="rounded border border-border px-2.5 py-1 text-caption font-semibold text-foreground">20 production-backed cases</span>
            <span className="rounded border border-border px-2.5 py-1 text-caption font-semibold text-foreground">6 product surfaces</span>
            <span className="rounded border border-border px-2.5 py-1 text-caption font-semibold text-foreground">17 failure conditions</span>
          </div>
        </header>

        <section id="tg71-current-group" className="py-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-caption font-semibold uppercase text-muted">Injected family</p>
              <h2 className="mt-1 text-title capitalize text-foreground">{visibleGroup}</h2>
            </div>
            <p id="tg71-retry-result" role="status" className="max-w-xl text-label text-muted">
              {result}
            </p>
          </div>

          <div id="tg71-case-list" className="mt-4 divide-y divide-border/50 border-y border-border/50">
            {cases.map((entry) => (
              <article id={`case-${entry.id}`} className="grid gap-4 py-5 lg:grid-cols-[180px_minmax(0,1fr)_220px]" key={entry.id} data-status={entry.status}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="size-4 shrink-0 text-danger-700" aria-hidden="true" />
                    <p className="text-label font-semibold text-foreground">{entry.workflow}</p>
                  </div>
                  <p className="mt-1 text-caption uppercase text-muted">{entry.surface} · {entry.status}</p>
                  <p className="mt-2 break-words text-caption text-muted">{entry.injection}</p>
                </div>

                <div className="min-w-0 space-y-3">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-700" aria-hidden="true" />
                    <div>
                      <p className="text-caption font-semibold uppercase text-muted">Truthful state</p>
                      <p className="text-body text-foreground">{entry.truthfulState}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                    <div>
                      <p className="text-caption font-semibold uppercase text-muted">Preserved and audited</p>
                      <p className="text-body text-foreground">{entry.preservedInput} {entry.auditContract}</p>
                    </div>
                  </div>
                </div>

                <div className="min-w-0 border-l-2 border-border pl-3">
                  <p className="text-caption font-semibold uppercase text-muted">Bounded recovery</p>
                  <p className="mt-1 text-caption text-foreground">{entry.retryContract}</p>
                  <p className="mt-2 break-all text-caption text-muted">{entry.executionKind} · {entry.productionFile}</p>
                  <Button
                    className="mt-3 w-full justify-center"
                    tone="secondary"
                    onClick={() => setResult(`${entry.workflow}: verified by ${entry.evidenceTest} in ${entry.evidenceFile}.`)}
                  >
                    <RefreshCw className="size-4" aria-hidden="true" />
                    Show test evidence
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("TG-UX-071 proof root is missing.");
createRoot(root).render(<FailureInjectionHarness />);
