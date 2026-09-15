---
id: CE-1
title: Extract the existing consumer app and widget
status: Done
assignee:
  - '@codex'
created_date: '2026-09-14 21:45'
updated_date: '2026-09-14 23:35'
labels: []
dependencies: []
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Copy and adapt the current TraceGenie implementation for one project. Preserve the original theme, shell, issue screens, reporter view, widget and screenshot capture. The earlier rewritten Community attempt is archived and its completion statuses are superseded.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Original UI and widget components are present with recorded source provenance.
- [x] #2 The consumer app and widget build independently with the existing visual design.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Copy the source with hashes, retain the original UI and widget, and adapt the copied composition.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Copied 424 source files from original revision 46a14d6 plus recorded current settings changes. Preserved original React consumer screens, theme, secure reporter flow and widget screenshot/privacy components. Archived the rejected rewrite separately. All workspaces build. Source custody verification confirms every recorded original file hash, HEAD and dirty status are unchanged.
<!-- SECTION:FINAL_SUMMARY:END -->
