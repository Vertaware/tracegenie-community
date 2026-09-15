/** Development-only entry from motion.html; not imported by the production app. */
import { useEffect,useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowRight,Check,Copy,Filter,Mail,MessageCircle,Plus,RotateCcw,Settings,Sparkles,X } from "lucide-react";
import { MotionCelebration,MotionNumber,MotionPresence,MotionSurface,useReducedMotion } from "@tracegenie/shared/motion";
import { FeedbackWidget } from "@tracegenie/widget";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { HeaderFilterMenu } from "../components/ui/DataTable";
import { Menu,MenuContent,MenuItem,MenuTrigger } from "../components/ui/Menu";
import { StatusChip } from "../components/ui/StatusChip";
import { ToastContainer,useToast } from "../components/ui/Toast";
import { TraceLogo } from "../components/ui/TraceLogo";
import "../styles/index.css";

// Isolated mock endpoint: exercising the real widget cannot create reports or send email.
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith(`${location.origin}/__motion-lab__/`)) {
    await new Promise(resolve => setTimeout(resolve, 500));
    return new Response(JSON.stringify({ feedback: {
      id: "motion-preview", ticketNumber: 42, trackingUrl: null,
      responseExpectation: "Preview complete. No report was saved or email sent.",
    } }), { status: 201, headers: { "Content-Type": "application/json" } });
  }
  return originalFetch(input, init);
};

function MotionLab() {
  const [round, setRound] = useState(0);
  const [count, setCount] = useState(2);
  const [copied, setCopied] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const [status, setStatus] = useState("new");
  const [burst, setBurst] = useState(0);
  const { toasts, addToast, dismissToast } = useToast();
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!drawer) return;
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const closeButton = document.getElementById("motion-drawer-close");
    document.body.style.overflow = "hidden";
    closeButton?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawer(false);
      if (event.key === "Tab") { event.preventDefault(); closeButton?.focus(); }
    };
    const onFocus = (event: FocusEvent) => {
      if (!document.getElementById("motion-drawer")?.contains(event.target as Node)) closeButton?.focus();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
      document.body.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, [drawer]);
  return (
    <main id="motion-playground" className="mx-auto max-w-6xl space-y-8 px-6 py-10">
      <header id="motion-playground-header" className="flex flex-wrap items-center justify-between gap-5">
        <div className="space-y-5">
          <TraceLogo size="sm" />
          <div className="space-y-2">
            <p className="text-caption font-semibold uppercase tracking-normal text-primary">Community design system</p>
            <h1 className="text-display font-semibold tracking-normal text-foreground">Motion playground</h1>
            <p className="max-w-xl text-body text-muted">Press, hover, open, close, and celebrate. The same components powering your app.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button tone="secondary" onClick={() => setRound(value => value + 1)}><RotateCcw className="mr-2 size-4" />Replay entrances</Button>
          <a className="tg-action-button inline-flex items-center gap-2 px-3 text-label text-primary" href="/projects/community/settings">Back to settings<ArrowRight className="size-4" /></a>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-3 border-y border-border/50 py-3 text-caption text-muted">
        <span className="inline-flex items-center gap-2 text-primary"><Sparkles className="size-4" />Motion 13 · shared springs + CSS recipes</span>
        <span>140–320 ms interactions</span><span>700 ms celebrations</span>
        <span id="motion-preference">{reduced ? "Reduced motion active" : "Full motion active"}</span>
      </div>
      <div key={round} id="motion-recipes" className="grid gap-5 md:grid-cols-2">
        <section id="motion-controls" className="tg-directory-reveal tg-card space-y-5 p-6">
          <h2 className="text-title">01 · Buttons with bounce</h2>
          <p className="text-body text-muted">A little lift, a passing highlight, a firm press, and a copy check that lands.</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => addToast("success", "That feels good.")}><Plus className="mr-2 size-4" />Primary action</Button>
            <Button tone="secondary" onClick={() => setCopied(value => !value)} className="tg-copy-button" data-copied={copied}>
              {copied ? <Check className="mr-2 size-4" /> : <Copy className="mr-2 size-4" />}{copied ? "Copied" : "Preview copy"}
            </Button>
            <Button disabled>Disabled</Button>
          </div>
          <label className="block space-y-2 text-label">Focus a field<Input placeholder="A calmer glow while you type" /></label>
        </section>
        <section id="motion-cards" className="tg-directory-reveal tg-card space-y-5 p-6">
          <h2 className="text-title">02 · Cards that lift</h2>
          <p className="text-body text-muted">Staggered entrances, raised surfaces, and icons with a playful tilt.</p>
          <div className="grid grid-cols-2 gap-3">
            {[{ title: "Email", icon: Mail }, { title: "Widget", icon: MessageCircle }].map(item => (
              <button key={item.title} className="tg-directory-card tg-card flex flex-col items-start gap-3 p-4 text-left" onClick={() => addToast("info", `${item.title} card selected`)}>
                <item.icon className="tg-directory-icon size-6 text-primary" /><span className="font-semibold">{item.title}</span><ArrowRight className="size-4 text-muted" />
              </button>
            ))}
          </div>
        </section>
        <section id="motion-overlays" className="tg-directory-reveal tg-card space-y-5 p-6">
          <h2 className="text-title">03 · Surfaces with weight</h2>
          <p className="text-body text-muted">Spring in, settle, and leave cleanly. Try closing and reopening quickly.</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button tone="secondary" onClick={() => setDialog(true)}>Open dialog</Button>
            <Button tone="secondary" onClick={() => setDrawer(true)}>Open drawer</Button>
            <Menu id="motion-account-menu">
              <MenuTrigger className="tg-action-button rounded-full border border-border px-4 py-2">Open menu</MenuTrigger>
              <MenuContent className="tg-popover-in absolute left-0 top-full z-20 mt-2 w-52 rounded-xl border border-border bg-surface p-2 shadow-overlay">
                <MenuItem className="w-full rounded-lg p-2 text-left hover:bg-primary-light" onSelect={() => addToast("info", "Account selected")}>Account</MenuItem>
                <MenuItem className="w-full rounded-lg p-2 text-left hover:bg-primary-light" onSelect={() => addToast("info", "Preferences selected")}>Preferences</MenuItem>
              </MenuContent>
            </Menu>
            <HeaderFilterMenu menuKey="status" label="Filter preview" icon={<Filter className="size-4" />} openMenu={filter} onToggle={key => setFilter(value => value === key ? null : key)}>
              <label className="flex gap-2 p-2 text-label"><input type="checkbox" />New</label>
              <label className="flex gap-2 p-2 text-label"><input type="checkbox" />Resolved</label>
            </HeaderFilterMenu>
          </div>
        </section>
        <section id="motion-feedback" className="tg-directory-reveal tg-card space-y-5 p-6">
          <h2 className="text-title">04 · Feedback you can feel</h2>
          <p className="text-body text-muted">Rolling counts, changing status, and notifications with a timed exit.</p>
          <div className="flex items-center gap-5"><span className="text-display font-semibold">Issues (<MotionNumber value={count} />)</span><StatusChip status={status} /></div>
          <div className="flex flex-wrap gap-2">
            <Button tone="secondary" onClick={() => setCount(value => value + 1)}>Add count</Button>
            <Button tone="secondary" onClick={() => setStatus(value => value === "fixed" ? "new" : "fixed")}>Change status</Button>
            <Button tone="secondary" onClick={() => addToast("success", "Settings saved. You’re all set.")}>Success toast</Button>
            <Button tone="ghost" onClick={() => addToast("error", "Preview error. Try that again.")}>Error toast</Button>
          </div>
        </section>
        <section id="motion-disclosure" className="tg-directory-reveal tg-card space-y-5 p-6">
          <h2 className="text-title">05 · Details unfold</h2>
          <details className="rounded-xl border border-border p-4">
            <summary className="tg-disclosure-summary cursor-pointer font-medium">Open the details</summary>
            <div className="space-y-3 pt-4"><p className="text-body text-muted">A measured reveal keeps the content connected to its trigger.</p><label className="flex gap-2 text-label"><input type="checkbox" />Enable notifications</label></div>
          </details>
        </section>
        <section id="motion-completion" className="tg-directory-reveal tg-card space-y-5 p-6">
          <h2 className="text-title">06 · A small celebration</h2>
          <div className="flex items-center gap-6">
            <div key={burst} className="relative flex size-16 items-center justify-center rounded-full bg-success-50 text-success-700"><MotionCelebration /><Check className="size-8" /></div>
            <div className="space-y-3"><p className="text-body text-muted">A finite burst for a finished action.</p><Button tone="secondary" onClick={() => setBurst(value => value + 1)}>Celebrate again</Button></div>
          </div>
        </section>
      </div>
      <section id="motion-widget-preview" className="tg-card flex flex-wrap items-center justify-between gap-5 p-6">
        <div className="space-y-2"><h2 className="text-title">07 · Try the actual widget</h2><p className="text-body text-muted">Use “Preview report” below. Submit a sample to see the success choreography. Nothing is sent or saved.</p></div><Settings className="size-7 text-primary" />
      </section>
      <ConfirmDialog isOpen={dialog} title="A dialog with some presence" description="Escape, cancel, or confirm. Focus returns to the control that opened it." confirmText="Looks good" onCancel={() => setDialog(false)} onConfirm={() => { setDialog(false); addToast("success", "Confirmed."); }} />
      <MotionPresence>
        {drawer ? <MotionSurface kind="fade" className="fixed inset-0 z-40 bg-foreground/20" onClick={() => setDrawer(false)}>
          <MotionSurface id="motion-drawer" kind="drawer" role="dialog" aria-modal="true" aria-labelledby="motion-drawer-title" className="absolute inset-y-0 right-0 flex w-80 flex-col gap-5 border-l border-border bg-surface p-6 shadow-overlay" onClick={event => event.stopPropagation()}>
            <Button id="motion-drawer-close" tone="ghost" onClick={() => setDrawer(false)}><X className="mr-2 size-4" />Close drawer</Button><h2 id="motion-drawer-title" className="text-title">Slide, then settle.</h2><p className="text-body text-muted">The shared drawer recipe powers mobile navigation.</p>
          </MotionSurface>
        </MotionSurface> : null}
      </MotionPresence>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <FeedbackWidget apiBaseUrl={`${location.origin}/__motion-lab__`} projectKey="motion-preview" appName="Motion playground" appEnvironment="preview" appVersion="1" launcherLabel="Preview report" fetchProjectConfig={false} widgetSessionToken="preview-only" widgetConfig={{ allowScreenshot: false, allowConsoleCapture: false, allowClientErrorContext: false, allowNetworkSummary: false }} />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<MotionLab />);
