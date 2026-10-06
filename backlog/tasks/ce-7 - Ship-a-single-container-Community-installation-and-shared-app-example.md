---
id: CE-7
title: Ship a single-container Community installation and shared-app example
status: Done
assignee: []
created_date: '2026-10-06 01:54'
updated_date: '2026-10-06 02:13'
labels: []
dependencies: []
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Package the existing application, PostgreSQL, worker and gateway together. Support rebuilding a customer application image to run both products in the same container, with truthful installation documentation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 One running Community container preserves reports, screenshots and settings through restart and replacement
- [x] #2 Backup, restore, upgrade and migration from the 0.1.0 backup format are verified
- [x] #3 A customer-app example runs in the same container and is exercised by release tests
- [x] #4 README and self-hosting instructions describe the tested setup and its limits
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the single-container runtime, installer, recovery and upgrade commands, and an example for rebuilding a customer Node app into the same image. The final ARM64 archive passed 154 acceptance checks: 144 reporting/persistence checks across nine phases plus 10 packaging checks, including crash recovery, corrupted-backup refusal, shared-app operation and migration from the actual 0.1 archive. Workspace typechecks, repository hygiene and syntax/config parsing passed; bundled source matches 355 checkout files. README and operator guides describe the supported paths and limitations. Evidence: .local/verification/single-container/result.json. Changes and the 0.2.0 archive are local; AMD64 CI, external email/public TLS, and publishing remain unverified or not performed.
<!-- SECTION:FINAL_SUMMARY:END -->
