---
id: CE-2
title: Remove SaaS dependencies and enforce one project
status: Done
assignee: []
created_date: '2026-09-14 21:45'
updated_date: '2026-09-14 23:35'
labels: []
dependencies: []
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Keep the supporting original services needed by the consumer app and widget. Remove platform administration, billing, multi-project management, MCP, surveys, ideas and external integrations.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Only the single project and agreed consumer/widget operations are exposed.
- [x] #2 The database prevents a second project and retained API operations remain authorized.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Remove excluded routes and dependencies from the copied app; preserve core authorization and enforce one project in PostgreSQL.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Removed SaaS/platform, billing, surveys, ideas, external integrations and MCP entry points; kept original supporting services and internal membership boundaries. PostgreSQL singleton indexes reject a second project or installation. Runtime checks confirm excluded routes are absent, screenshot access requires authentication and unconfigured widget origins are denied. Source compatibility types remain where the retained app uses them.
<!-- SECTION:FINAL_SUMMARY:END -->
