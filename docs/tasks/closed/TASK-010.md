# TASK-010: Remove runtime.json from bot operation

## Background

The local runtime snapshot stores only the system IDs of user sessions.
Firestore already stores the Telegram bindings needed to re-create those
sessions and the Telegram chat settings covered by
[TASK-011](./TASK-011.md). The bot still periodically writes the snapshot
and sends it to administrators as a backup.

## Require

Remove the runtime snapshot from bot startup, periodic writes, and
administrator backups. Remove its configuration settings and update the setup
instructions. Keep the session registry in memory, restore sessions from
persisted Telegram bindings on startup, and create sessions as needed during
normal operation. Continue loading Telegram chat settings from Firestore.

Keep the standalone Telegram settings migration available for deployments
that still need to import settings from an explicitly supplied legacy snapshot.

## Acceptance

- The bot starts and runs without `runtime.json` or the
  `runtime_cache_filename` and `runtime_dump_interval_sec` settings. If a legacy
  snapshot is present, the bot ignores it.
- The bot stops writing runtime snapshots and sending them to administrators.
  The `/backup` command for the snapshot is removed.
- After a restart, users with persisted Telegram bindings can receive messages
  before they contact the bot. Restoring these users emits no join notifications.
- Normal user interaction still creates sessions as needed. Existing user data
  and Telegram bindings are preserved.
- Telegram chat settings load from Firestore after a restart. The standalone
  migration can import settings from a supplied legacy snapshot without
  requiring the removed configuration settings or overwriting settings already
  in Firestore.
- The configuration template and setup instructions work without a runtime
  snapshot.
