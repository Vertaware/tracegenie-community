import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("container hierarchy", () => {
  it("keeps issue context as unframed reading sections and preserves real object and tool cards", () => {
    const issueSource = source("../src/features/issues/IssueDetailPage.tsx");

    for (const id of [
      "issue-survey-response-list",
      "issue-selected-element-list",
      "issue-customer-impact-list",
      "issue-consent-snapshot-list",
      "issue-feature-context-list",
      "issue-session-replay-list",
      "issue-product-context-list",
      "issue-environment-list",
    ]) {
      expect(issueSource).toMatch(new RegExp(`id=[\"']${id}[\"'][^>]+className=\\{(?:cn\\()?DETAIL_CONTEXT_LIST`));
    }

    expect(issueSource).toContain('id="issue-selected-text-body" className="border-y border-border/35 py-3"');
    expect(issueSource).toMatch(/id="issue-client-error-stack"[\s\S]{0,160}<div className="border-y border-border\/35 py-3">/);
    expect(issueSource).not.toMatch(/id="issue-(?:selected-text-body|product-feature-flags|product-experiments)"[^>]+rounded-2xl/);
    expect(issueSource).toContain('id="issue-management-details"');
    expect(issueSource).not.toContain('className="rounded-3xl border border-border/25 bg-surface p-5 md:p-6"');
  });

  it("keeps the invite form unframed and frames only its repeated product selector", () => {
    const inviteSource = source("../src/features/users/InviteMemberPage.tsx");

    expect(inviteSource).not.toMatch(/<Card\b|invite-member-card/);
    expect(inviteSource).toContain('id="invite-member-form-section" className="border-t border-border pt-5"');
    expect(inviteSource).toMatch(/id="invite-member-projects"[\s\S]{0,180}rounded-xl border border-border bg-surface/);
    expect(inviteSource).toContain('id="invite-member-fallback-url" className="tg-panel-reveal mt-5 border-t border-border/35 pt-4"');
  });
});
