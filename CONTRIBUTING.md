# Contributing

Use Node 24 and Docker with Compose. From the repository root, run `npm ci` and `npm run dev`. Setup creates private local credentials and one project; see the README for URLs and the self-hosting guide for Docker releases.

Before submitting changes:

```sh
npm run check:repo
npm run typecheck
npm test
npm run build
```

`check:repo` checks relative imports, debugger statements and private/generated files in the Git-visible tree. Type checking also rejects unused local declarations and imports. It includes untracked files, so it also works before the first commit. It is a hygiene check, not a complete secret scanner or security audit.

`npm test` is the Community regression suite. It covers shared contracts, OTP/idempotency, email settings, screenshot privacy, widget sessions and behavior, shared controls/motion, and first-run setup. Database-backed checks require the local setup. Seven inherited survey widget cases are excluded because Community does not expose surveys. Other retained historical tests are not part of this gate and require adaptation before inclusion; a file's presence is not a claim that it passes.

Keep changes within the one-project consumer app, reporter workflow and widget. Keep API authorization, screenshot privacy, notification behavior and migration history intact. Prefer small changes that preserve the existing screens and design system.

Do not commit `.env`, `.local`, uploads, dependencies or generated builds. Local verification receipts and recovery archives belong in `.local/`; do not attach credentials, real customer reports or screenshots containing customer data. Keep the AGPL license, copyright notices and third-party notices with redistributed code.

## Contribution licensing

Original contributions submitted for inclusion are offered under AGPL-3.0-only, unless separately agreed in writing. Contributors retain their copyright. Only submit material you have the right to contribute and identify any third-party material and its license.

An AGPL contribution does not by itself grant the maintainers permission to relicense that contribution under proprietary terms. Before offering a commercial exception covering contributed code, the maintainers must obtain the necessary permissions from its rights holders. No separate commercial agreement or contributor assignment is created by this guide. See [Licensing](docs/LICENSING.md).

Release archives are created with `scripts/package-release.sh VERSION`. Rebuild and verify an archive after source changes; an older local archive is not evidence for the current source. Publication uses the Community GitHub/registry account once selected.
