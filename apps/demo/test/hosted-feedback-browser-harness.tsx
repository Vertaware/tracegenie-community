import React from "react";
import { createRoot } from "react-dom/client";

import "../src/app/styles.css";
import { App } from "../src/app/App";

const state = new URLSearchParams(window.location.search).get("state") ?? "ready";
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = String(input);
  if (url.includes("/hosted-config")) {
    if (state === "error") {
      return new Response(JSON.stringify({ error: { message: "This feedback page is no longer available." } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      key: "acme-checkout",
      name: "Acme Checkout",
      defaultEnvironment: "production",
      widgetConfig: {
        allowScreenshot: true,
        reporterIdentity: {
          enabled: true,
          collectName: true,
          collectEmail: true,
          responseExpectation: "Expect an update within two business days.",
        },
        privacy: { privacyPolicyUrl: "https://acme.example/privacy" },
        appearance: { launcherLabel: "Send feedback", modalTitle: "Send feedback" },
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/hosted-session")) {
    return new Response(JSON.stringify({ token: "proof-widget-session" }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/public/feedback")) {
    return new Response(JSON.stringify({ feedback: {
      id: "proof-feedback",
      ticketNumber: 742,
      trackingUrl: "https://app.traceitgenie.com/reporter#bridge=opaque-proof-token",
      responseExpectation: "Expect an update within two business days.",
    } }), { status: 201, headers: { "content-type": "application/json" } });
  }
  return originalFetch(input, init);
};

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
