---
id: CE-6
title: Sweep Community repository for release cleanup
status: Done
assignee: []
created_date: '2026-09-15 03:28'
updated_date: '2026-09-15 03:55'
labels: []
dependencies: []
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Remove verified obsolete extraction artifacts, SaaS-only fixtures, unused imports/dependencies and dead commented code in the separate Community repo. Preserve product behavior, schema history and local data. Verify build, types, retained tests and runtime.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Dead and obsolete candidates are verified against imports, routes and source before removal
- [x] #2 Local custody and verification artifacts are excluded from the shareable tree; setup docs match the repo
- [x] #3 Retained Community build, types, tests and runtime pass with material limits documented
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Completed the separate Community repository cleanup. Archived 107 obsolete/local-only files (62 obsolete fixture files plus historical receipts), removed eight unused direct dependencies and 61 lockfile entries without unrelated version changes, and removed 1,301 net source lines of unused helpers/imports/no-op code. The widget now defaults to its self-hosted script origin. Added repository hygiene and noUnusedLocals gates plus contributor instructions. Final verification: 236 passing Community tests, seven existing survey exclusions, gated typecheck/build, fresh lockfile install/build, and ten runtime/browser checks with both reports intact. Recovery and evidence: .local/repository-cleanup/README.md. Original TraceGenie repo untouched. Remaining release boundaries: older tests outside the Community gate need adaptation; rebuild the earlier release archive before publication.
<!-- SECTION:FINAL_SUMMARY:END -->
