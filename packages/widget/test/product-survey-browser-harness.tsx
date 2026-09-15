import React from "react";
import { createRoot } from "react-dom/client";

import "../src/styles/widget.css";
import { FeedbackWidget } from "../src/components/FeedbackWidget";

const projectKey = "checkout-proof";

window.fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith("/widget-config")) {
    return new Response(JSON.stringify({
      key: projectKey,
      name: "Checkout workspace",
      organizationName: "Acme Product",
      defaultEnvironment: "production",
      widgetConfig: {
        appearance: {
          compactMode: true,
          modalTitle: "Share product feedback",
          launcherLabel: "Feedback",
          launcherPresentation: "icon-text",
        },
        privacy: {
          privacyUrl: "https://example.test/privacy",
          retentionDays: 365,
          attachmentRetentionDays: 30,
        },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.endsWith("/surveys/active")) {
    return new Response(JSON.stringify({
      campaign: {
        id: "campaign-proof",
        name: "Checkout NPS",
        status: "active",
        type: "nps",
        question: "Would you recommend the new checkout?",
        answerKind: "score",
        scaleMin: 0,
        scaleMax: 10,
        options: [],
        audience: { segments: ["enterprise"], roles: [], featureKeys: [], funnelSteps: [] },
        contextRequirements: { required: ["account", "release.version"] },
        consentRequired: true,
        consentLabel: "I agree to share this feedback with the product team.",
        privacyUrl: "https://example.test/privacy",
        retentionDays: 30,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.endsWith("/surveys/campaign-proof/responses")) {
    return new Response(JSON.stringify({
      response: {
        expiresAt: "2026-08-14T12:00:00.000Z",
        provenance: { missing: ["release.version"] },
      },
      idempotent: false,
    }), { status: 201, headers: { "Content-Type": "application/json" } });
  }
  throw new Error(`Unexpected proof request: ${url} ${init?.method ?? "GET"}`);
};

const root = document.getElementById("root");

if (!root) {
  throw new Error("Widget survey proof root was not found.");
}

createRoot(root).render(
  <React.StrictMode>
    <FeedbackWidget
      apiBaseUrl="http://127.0.0.1:4000"
      projectKey={projectKey}
      appName="Checkout workspace"
      appEnvironment="production"
      appVersion="2.4.0"
      fetchProjectConfig
      productContext={{
        customer: { segment: "enterprise", role: "admin" },
        feature: { key: "checkout-v2" },
        funnelStep: "payment",
      }}
    />
  </React.StrictMode>,
);
