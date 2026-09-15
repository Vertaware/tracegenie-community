# TraceGenie Community 0.1.0

The first Community release brings the existing TraceGenie reporting experience to a self-hosted installation with one project.

## Included

- Consumer issue inbox, filtering, assignment, severity, status history, duplicate marking, comments, and resolution.
- Embedded widget, hosted feedback, screenshots and privacy editor, attachments, and technical context.
- Secure reporter access and replies, installation-level Resend/SMTP configuration, and notification retries.
- First-run administrator setup, Docker installer, health checks, backup, restore, and versioned upgrades.
- AGPL-3.0-only source and matching source archive shipped with the release.

## Installing

Download the archive matching your Docker architecture and its checksum. Follow [Self-hosting](https://github.com/Vertaware/tracegenie-community/blob/v0.1.0/docs/SELF_HOSTING.md). Source-only GitHub archives do not include prebuilt container images; use the installer archive for the no-build installation.

The 0.1 series is an early release. Keep backups and test your website integration before relying on it.

## Hosted feedback fix

The hosted form now accepts same-origin browser configuration requests that omit the `Origin` header. Requests must match the configured public host and carry same-origin browser metadata; explicit origins still use the existing project allowlist.

## Verification and limits

Each published platform must pass the supported regression suite and an installation check that exercises bootstrap, report and screenshot persistence, triage, local email, reporter access and replies, restart, backup, and restoration. GitHub Actions logs provide the results for the tagged source.

Email delivery is exercised with a local SMTP inbox. External Resend delivery, public DNS and automatic TLS certificate issuance require verification in your own deployment. No live customer data or provider credentials are included in the release.
