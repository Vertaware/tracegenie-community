import { Component,type ReactNode } from "react";

/** Keep a provider/render failure from leaving the entire app blank. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <section role="alert" aria-labelledby="app-error-title" className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 shadow-panel">
          <h1 id="app-error-title" className="text-display">TraceGenie couldn’t load</h1>
          <p className="mt-3 text-body text-muted">Something went wrong while opening this page. Reload to try again.</p>
          <a href={window.location.href} className="mt-6 inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-label font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            Reload page
          </a>
        </section>
      </main>
    );
  }
}
