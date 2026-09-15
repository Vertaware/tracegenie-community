import { createRoot } from "react-dom/client";

import { FeedbackWidget } from "../src/components/FeedbackWidget";

createRoot(document.getElementById("root")!).render(
  <main id="widget-proof-page" style={{ boxSizing: "border-box", width: "100%", minHeight: "100vh", padding: "24px", background: "#f4f7fb", color: "#172033" }}>
    <section id="protected-capture-fixture" style={{ boxSizing: "border-box", width: "min(640px, 100%)", padding: "24px", background: "#ffffff" }}>
      <h1 style={{ margin: "0 0 16px", fontSize: "24px" }}>Checkout review</h1>
      <p style={{ margin: "0 0 16px" }}>Public order status is ready for review.</p>
      <div
        id="protected-account-number"
        data-tracegenie-mask
        style={{ width: "180px", height: "64px", padding: "12px", background: "#e11d48", color: "#ffffff" }}
      >
        Account 4111 1111 1111 1111
      </div>
      <label style={{ display: "grid", width: "180px", gap: "4px", marginTop: "12px" }}>
        One-time code
        <input id="protected-one-time-code" autoComplete="one-time-code" defaultValue="927144" style={{ height: "40px" }} />
      </label>
    </section>
    <FeedbackWidget
      apiBaseUrl="http://127.0.0.1:4000"
      projectKey="tracegenie-responsive-proof"
      appName="TraceGenie responsive proof"
      appEnvironment="test"
      appVersion="test"
      fetchProjectConfig
      widgetConfig={{
        allowScreenshot: true,
        allowPointSelection: true,
        allowConsoleCapture: true,
        allowClientErrorContext: true,
        allowNetworkSummary: true,
        notificationBranding: {
          brandName: "Acme Product Operations",
          primaryColor: "#2563eb",
          accentColor: "#344760",
        },
        privacy: {
          privacyUrl: "https://acme.example/privacy",
          retentionDays: 180,
          attachmentRetentionDays: 30,
          redactionMode: "standard",
          mcpEvidenceSharing: "raw_allowed",
          suppressSelectedText: false,
          customRedactionTerms: [],
        },
        fields: {
          stepsToReproduce: { enabled: true },
          expectedResult: { enabled: true },
          actualResult: { enabled: true },
        },
      }}
    />
  </main>,
);
