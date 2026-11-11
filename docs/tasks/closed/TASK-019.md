# TASK-019: Refactoring: Decouple Telegram and agent scenarios from Firestore

## Background

Managers chat tests exercise Telegram processing and agent context through a
concrete Firestore messages adapter. Their fixtures imitate SDK queries and
document snapshots even though the components accept `IMessagesBacklog`. This
complicates the typed test migration in [TASK-015](../TASK-015.md).

## Require

Use an in-memory implementation of `IMessagesBacklog` in Telegram and managers
agent scenarios, retaining the real backlog cache. Simulate storage delays and
failures at the backlog interface boundary.

Separate Firestore-specific assertions into adapter tests. Preserve coverage of
document serialization and storage error handling alongside existing behavioral
coverage.

## Acceptance

- Telegram and agent scenarios no longer import Firestore SDK types or replace
  `GoogleAuth.get_firestore()` or the API rate limiter.
- Reply-chain behavior remains covered across edits and cache recreation.
- Slow and failed persistence remain covered independently of Firestore.
- Firestore adapter tests retain checks of stored document formats and batch
  lookup behavior.
- No `any` or broad unchecked type assertions are introduced.
- `npm run autotests` and `npm run build` succeed.
