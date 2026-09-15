import assert from "node:assert/strict";
import test from "node:test";

import {
  featureContextSchema,
  feedbackConsentSnapshotSchema,
  feedbackCustomerImpactSchema,
  feedbackEventTrailSchema,
  feedbackEvidenceTimelineSchema,
  feedbackExternalRefsSchema,
  feedbackExtraContextSchema,
  feedbackNetworkEntriesSchema,
  feedbackSelectedTextSuggestionSchema,
  feedbackSurveyResponseSchema,
  getProductionPrivacyReadiness,
  productContextSchema,
  selectedElementSchema,
  sessionReplayClipIdSchema,
  widgetProjectConfigSchema,
} from "../src/schemas/widget";

test("external refs accept premium provider links", () => {
  const result = feedbackExternalRefsSchema.safeParse([
    {
      provider: "posthog",
      label: "PostHog person",
      url: "https://app.posthog.com/project/1/person/abc",
    },
    {
      provider: "launchdarkly",
      label: "LaunchDarkly flag",
      url: "https://app.launchdarkly.com/projects/acme/flags/checkout-redesign",
    },
    {
      provider: "zendesk",
      label: "Zendesk ticket",
      url: "https://example.zendesk.com/agent/tickets/123",
    },
    {
      provider: "intercom",
      label: "Intercom conversation",
      url: "https://app.intercom.com/a/inbox/inbox/conversation/456",
    },
  ]);

  assert.equal(result.success, true);
});

test("product context accepts bounded experiment variants", () => {
  assert.equal(productContextSchema.safeParse({
    experiments: {
      checkout_copy: "variant-b",
      pricing_page: "control",
    },
  }).success, true);

  assert.equal(productContextSchema.safeParse({
    experiments: {},
  }).success, false);
  assert.equal(productContextSchema.safeParse({
    experiments: {
      checkout_copy: "x".repeat(81),
    },
  }).success, false);
});

test("product context accepts bounded cohort and recurring revenue", () => {
  const result = productContextSchema.safeParse({
    customer: {
      segment: "enterprise",
      cohort: "2026-q3-beta",
    },
    revenue: {
      mrr: 12000,
      arr: 144000,
      currency: "USD",
    },
  });

  assert.equal(result.success, true);
});

test("product context rejects revenue without a valid currency", () => {
  assert.equal(productContextSchema.safeParse({
    revenue: {
      mrr: 12000,
    },
  }).success, false);

  assert.equal(productContextSchema.safeParse({
    revenue: {
      arr: 144000,
      currency: "usd",
    },
  }).success, false);
});

test("feedback extra context validates productContext cohort and revenue", () => {
  assert.equal(feedbackExtraContextSchema.safeParse({
    productContext: {
      customer: {
        cohort: "2026-q3-beta",
      },
      revenue: {
        mrr: 12000,
        currency: "USD",
      },
    },
  }).success, true);

  assert.equal(feedbackExtraContextSchema.safeParse({
    productContext: {
      revenue: {
        mrr: 12000,
        currency: "usd",
      },
    },
  }).success, false);
});

test("survey responses accept bounded score or text answers", () => {
  const result = feedbackSurveyResponseSchema.safeParse({
    type: "nps",
    question: "How likely are you to recommend this product?",
    score: 9,
    submittedAt: "2026-07-05T12:00:00.000Z",
  });

  assert.equal(result.success, true);
});

test("widget config accepts a bounded optional survey prompt", () => {
  const defaultConfig = widgetProjectConfigSchema.parse({});
  assert.equal(defaultConfig.surveyPrompt.enabled, false);
  assert.deepEqual(defaultConfig.privacy, {
    privacyOwnerEmail: "",
    privacyUrl: "",
    retentionDays: null,
    attachmentRetentionDays: null,
    redactionMode: "standard",
    mcpEvidenceSharing: "raw_allowed",
    suppressSelectedText: false,
    customRedactionTerms: [],
  });

  const configured = widgetProjectConfigSchema.parse({
    privacy: {
      redactionMode: "technical_metadata",
      customRedactionTerms: ["Acme Account", "VIP-123"],
    },
    surveyPrompt: {
      enabled: true,
      type: "ces",
      question: "Was this easy?",
    },
  });

  assert.equal(configured.privacy.redactionMode, "technical_metadata");
  assert.deepEqual(configured.privacy.customRedactionTerms, ["Acme Account", "VIP-123"]);
  assert.deepEqual(configured.surveyPrompt, {
    enabled: true,
    type: "ces",
    question: "Was this easy?",
  });
  assert.equal(widgetProjectConfigSchema.safeParse({
    surveyPrompt: {
      enabled: true,
      type: "csat",
      question: "x".repeat(161),
    },
  }).success, false);
});

test("widget config defaults reporter identity off and bounds consent receipt copy", () => {
  const defaults = widgetProjectConfigSchema.parse({});
  assert.deepEqual(defaults.reporterIdentity, {
    enabled: false,
    collectName: true,
    collectEmail: true,
    consentLabel: "I agree to share these contact details for updates about this report.",
    responseExpectation: "The team will follow up when there is an update.",
  });

  assert.equal(widgetProjectConfigSchema.safeParse({
    reporterIdentity: {
      enabled: true,
      collectName: false,
      collectEmail: false,
    },
  }).success, false);
  assert.equal(widgetProjectConfigSchema.safeParse({
    reporterIdentity: {
      enabled: true,
      responseExpectation: "x".repeat(241),
    },
  }).success, false);
});

test("production privacy readiness names unsafe enabled collector settings", () => {
  const blockers = getProductionPrivacyReadiness(widgetProjectConfigSchema.parse({
    allowScreenshot: true,
    allowPointSelection: true,
    privacy: {
      privacyUrl: "",
      retentionDays: null,
      attachmentRetentionDays: null,
      redactionMode: "standard",
      mcpEvidenceSharing: "raw_allowed",
      suppressSelectedText: false,
    },
  }));

  assert.deepEqual(blockers.map((blocker) => blocker.id), [
    "privacy_owner",
    "privacy_url",
    "issue_retention",
    "attachment_retention",
    "collector_redaction",
    "selected_text",
    "mcp_evidence",
  ]);
  assert.match(blockers.find((blocker) => blocker.id === "collector_redaction")?.detail ?? "", /screenshots, point selection/);
});

test("survey responses reject empty answers and oversized text", () => {
  assert.equal(feedbackSurveyResponseSchema.safeParse({ type: "csat" }).success, false);
  assert.equal(feedbackSurveyResponseSchema.safeParse({
    type: "beta_feedback",
    answer: "x".repeat(1001),
  }).success, false);
});

test("feedback extra context validates surveyResponse as a known bounded key", () => {
  assert.equal(feedbackExtraContextSchema.safeParse({
    surveyResponse: {
      type: "feature_satisfaction",
      choice: "satisfied",
    },
  }).success, true);

  assert.equal(feedbackExtraContextSchema.safeParse({
    surveyResponse: {
      type: "feature_satisfaction",
      answer: "x".repeat(1001),
    },
  }).success, false);
});

test("selected text suggestions accept bounded selected page text", () => {
  const result = feedbackSelectedTextSuggestionSchema.safeParse({
    text: "Selected checkout copy",
    url: "https://app.example.test/checkout",
    createdAt: "2026-07-05T12:00:00.000Z",
  });

  assert.equal(result.success, true);
});

test("selected elements accept bounded element metadata", () => {
  const result = selectedElementSchema.safeParse({
    tagName: "button",
    role: "button",
    label: "Submit payment",
  });

  assert.equal(result.success, true);
});

test("feedback extra context validates selectedElement as a known bounded key", () => {
  assert.equal(feedbackExtraContextSchema.safeParse({
    selectedElement: {
      tagName: "button",
      role: "button",
      label: "Submit payment",
    },
  }).success, true);

  assert.equal(feedbackExtraContextSchema.safeParse({
    selectedElement: {
      label: "x".repeat(121),
    },
  }).success, false);
});

test("evidence timeline accepts bounded events, redacts URLs, and sorts newest first", () => {
  const result = feedbackEvidenceTimelineSchema.parse([
    {
      type: "form_submit",
      label: "Submitted checkout form",
      detail: "Reporter clicked pay.",
      timestamp: "2026-07-05T12:00:00.000Z",
      url: "https://app.example.test/checkout?token=secret#payment",
    },
    {
      type: "network",
      label: "Checkout API failed",
      detail: "Payment request returned an error.",
      timestamp: "2026-07-05T12:00:03.000Z",
      url: "https://app.example.test/api/checkout?token=secret#payment",
    },
  ]);

  assert.equal(result[0]?.label, "Checkout API failed");
  assert.equal(result[0]?.url, "https://app.example.test/api/checkout");
  assert.equal(result[1]?.url, "https://app.example.test/checkout");
});

test("feedback extra context validates evidenceTimeline as a known bounded key", () => {
  assert.equal(feedbackExtraContextSchema.safeParse({
    evidenceTimeline: [
      {
        type: "network",
        label: "Checkout API failed",
        detail: "Payment request returned an error.",
        timestamp: "2026-07-05T12:00:00.000Z",
      },
    ],
  }).success, true);

  assert.equal(feedbackExtraContextSchema.safeParse({
    evidenceTimeline: [
      {
        type: "network",
        label: "x".repeat(121),
        detail: "Payment request returned an error.",
        timestamp: "2026-07-05T12:00:00.000Z",
      },
    ],
  }).success, false);

  assert.equal(feedbackExtraContextSchema.safeParse({
    evidenceTimeline: Array.from({ length: 51 }, (_, index) => ({
      type: "custom",
      label: `Custom event ${index}`,
      detail: "Bounded evidence event.",
      timestamp: "2026-07-05T12:00:00.000Z",
    })),
  }).success, false);
});

test("event trails accept bounded properties and redact source URLs", () => {
  const result = feedbackEventTrailSchema.parse([
    {
      name: "checkout_step",
      timestamp: "2026-07-05T12:00:00.000Z",
      url: "https://app.example.test/checkout?token=secret#payment",
      properties: {
        step: "payment",
        attempt: 2,
        retry: false,
        tags: ["checkout", "card", null],
      },
    },
  ]);

  assert.equal(result[0]?.url, "https://app.example.test/checkout");
});

test("feedback extra context validates eventTrail as a known bounded key", () => {
  const event = {
    name: "checkout_step",
    timestamp: "2026-07-05T12:00:00.000Z",
    url: "https://app.example.test/checkout",
    properties: {
      step: "payment",
    },
  };

  assert.equal(feedbackExtraContextSchema.safeParse({
    eventTrail: Array.from({ length: 20 }, () => event),
  }).success, true);

  assert.equal(feedbackExtraContextSchema.safeParse({
    eventTrail: Array.from({ length: 21 }, () => event),
  }).success, false);

  assert.equal(feedbackExtraContextSchema.safeParse({
    eventTrail: [
      {
        ...event,
        properties: {
          oversized: "x".repeat(501),
        },
      },
    ],
  }).success, false);

  assert.equal(feedbackExtraContextSchema.safeParse({
    eventTrail: [
      {
        ...event,
        properties: {
          nested: { step: "payment" },
        },
      },
    ],
  }).success, false);
});

test("network entries accept bounded metadata and redact source URLs", () => {
  const result = feedbackNetworkEntriesSchema.parse([
    {
      method: "POST",
      url: "https://app.example.test/api/checkout?token=secret#payment",
      statusCode: 500,
      durationMs: 120,
      timestamp: "2026-07-05T12:00:00.000Z",
      requestId: "req_123",
    },
  ]);

  assert.equal(result[0]?.url, "https://app.example.test/api/checkout");
});

test("feedback extra context validates networkEntries as a known bounded key", () => {
  const entry = {
    method: "POST",
    url: "https://app.example.test/api/checkout",
    statusCode: 500,
    durationMs: 120,
    timestamp: "2026-07-05T12:00:00.000Z",
  };

  assert.equal(feedbackExtraContextSchema.safeParse({
    networkEntries: [entry],
  }).success, true);

  assert.equal(feedbackExtraContextSchema.safeParse({
    networkEntries: [
      {
        ...entry,
        error: "x".repeat(501),
      },
    ],
  }).success, false);
});

test("selected text suggestion source URLs drop query strings and fragments", () => {
  const result = feedbackSelectedTextSuggestionSchema.parse({
    text: "Selected checkout copy",
    url: "https://app.example.test/checkout?token=secret#payment",
  });

  assert.equal(result.url, "https://app.example.test/checkout");
});

test("feedback extra context validates selectedTextSuggestion as a known bounded key", () => {
  assert.equal(feedbackExtraContextSchema.safeParse({
    selectedTextSuggestion: {
      text: "Selected checkout copy",
      url: "https://app.example.test/checkout",
    },
  }).success, true);

  assert.equal(feedbackExtraContextSchema.safeParse({
    selectedTextSuggestion: {
      text: "x".repeat(1001),
      url: "https://app.example.test/checkout",
    },
  }).success, false);
});

test("customer impact accepts bounded host-provided impact fields", () => {
  const result = feedbackCustomerImpactSchema.safeParse({
    summary: "Enterprise checkout is blocked.",
    affectedUsers: 42,
    affectedAccounts: 3,
    revenueAtRisk: {
      amount: 12000,
      currency: "USD",
    },
    churnRisk: "high",
  });

  assert.equal(result.success, true);
});

test("feature context accepts bounded feature identity fields", () => {
  const result = featureContextSchema.safeParse({
    area: "Billing",
    key: "invoice-export",
  });

  assert.equal(result.success, true);
});

test("feedback extra context validates featureContext as a known bounded key", () => {
  assert.equal(feedbackExtraContextSchema.safeParse({
    featureContext: {
      area: "Billing",
      key: "invoice-export",
    },
  }).success, true);

  assert.equal(feedbackExtraContextSchema.safeParse({
    featureContext: {
      area: "x".repeat(161),
    },
  }).success, false);
});

test("feedback extra context validates sessionReplayClipId as an opaque bounded key", () => {
  assert.equal(sessionReplayClipIdSchema.safeParse("replay_abc-123:clip.1").success, true);

  assert.equal(feedbackExtraContextSchema.safeParse({
    sessionReplayClipId: "replay_abc-123:clip.1",
  }).success, true);

  assert.equal(feedbackExtraContextSchema.safeParse({
    sessionReplayClipId: "https://app.example.test/replay/abc?token=secret",
  }).success, false);
});

test("feedback extra context validates customerImpact as a known bounded key", () => {
  assert.equal(feedbackExtraContextSchema.safeParse({
    customerImpact: {
      affectedUsers: 42,
      churnRisk: "high",
    },
  }).success, true);

  assert.equal(feedbackExtraContextSchema.safeParse({
    customerImpact: {
      revenueAtRisk: {
        amount: 12000,
        currency: "usd",
      },
    },
  }).success, false);
});

test("consent snapshots accept bounded capture consent states", () => {
  const result = feedbackConsentSnapshotSchema.safeParse({
    capturedAt: "2026-07-05T12:00:00.000Z",
    screenshot: { allowed: true, included: true },
    pointSelection: { allowed: true, included: false },
    console: { allowed: true, included: true },
    clientError: { allowed: true, included: false },
    network: { allowed: false, included: false },
    selectedText: { allowed: true, included: true },
    attachmentCount: 1,
  });

  assert.equal(result.success, true);
});

test("feedback extra context validates consentSnapshot as a known bounded key", () => {
  assert.equal(feedbackExtraContextSchema.safeParse({
    consentSnapshot: {
      capturedAt: "2026-07-05T12:00:00.000Z",
      screenshot: { allowed: true, included: true },
      pointSelection: { allowed: true, included: false },
      console: { allowed: true, included: true },
      clientError: { allowed: true, included: false },
      network: { allowed: false, included: false },
      selectedText: { allowed: true, included: true },
      attachmentCount: 1,
    },
  }).success, true);

  assert.equal(feedbackExtraContextSchema.safeParse({
    consentSnapshot: {
      capturedAt: "not-a-date",
      screenshot: { allowed: true, included: true },
      pointSelection: { allowed: true, included: false },
      console: { allowed: true, included: true },
      clientError: { allowed: true, included: false },
      network: { allowed: false, included: false },
      selectedText: { allowed: true, included: true },
      attachmentCount: 10,
    },
  }).success, false);

  assert.equal(feedbackExtraContextSchema.safeParse({
    consentSnapshot: {
      capturedAt: "2026-07-05T12:00:00.000Z",
      screenshot: { allowed: false, included: true },
      pointSelection: { allowed: true, included: false },
      console: { allowed: true, included: true },
      clientError: { allowed: true, included: false },
      network: { allowed: false, included: false },
      selectedText: { allowed: true, included: true },
      attachmentCount: 1,
    },
  }).success, false);
});
