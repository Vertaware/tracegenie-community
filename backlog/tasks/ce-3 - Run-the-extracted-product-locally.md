---
id: CE-3
title: Run the extracted product locally
status: Done
assignee: []
created_date: '2026-09-14 21:45'
updated_date: '2026-09-14 23:35'
labels: []
dependencies: []
priority: high
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Provide a fresh isolated installation using the retained API, database model, local storage and email interface.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 One command starts an isolated Community installation without production data or secrets.
- [x] #2 Widget submission, issue detail, staff triage and verified reporter follow-up work against persistence.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Use isolated local Postgres, local attachments and SMTP; seed a single project and verify the original feedback loop.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
npm run dev successfully initializes/builds/starts isolated Community services at API 4310, consumer 4311 and widget 4312. Stop/start preserved database reports, screenshots and replies. Actual browser tests submitted two reports, captured an automatic screenshot, sent staff/reporter replies and changed a ticket to Triaged. Notifications delivered to local Mailpit. No production data or credentials were used.
<!-- SECTION:FINAL_SUMMARY:END -->
