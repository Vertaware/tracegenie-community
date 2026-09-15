---
id: CE-5
title: Package Community for Docker self-hosting
status: Done
assignee: []
created_date: '2026-09-15 02:41'
updated_date: '2026-09-15 03:24'
labels: []
dependencies: []
ordinal: 5000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Prebuilt app and worker use one public URL with readiness and persistent storage
- [x] #2 First-run owner and single project setup is protected and closes after completion
- [x] #3 Install, restart, upgrade and isolated restore verified with persisted report, upload and email credentials
- [x] #4 Release archive and operator guide prepared without publishing to an account
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the Docker release archive and single-origin deployment, protected first-run owner/project setup, existing Email and Installation continuation, and start/stop/backup/restore/upgrade commands. Verified a clean archive install with 23 checks, restart/restore/upgrade with 15 checks each, seven browser checks, all workspace typechecks and 232 relevant automated tests across targeted runs. Widget behavior tests passed with a 15-second ceiling after build-related timeouts. ARM64 archive checksum and bundled image import verified. Evidence: docs/verification/self-hosting/README.md and release.json. Public GitHub/registry, AMD64 and public-domain TLS remain outside the locally verified scope. All work is in the separate Community repository; original checkout untouched.
<!-- SECTION:FINAL_SUMMARY:END -->
