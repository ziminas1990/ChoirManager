# TASK-010: Stop persisting user sessions in runtime.json

## Background

The runtime snapshot stores a list of user sessions containing only system IDs.
It does not preserve conversation state. Telegram bindings already persist in
Firestore and restore the sessions needed for communication when the bot starts.
Keeping a second list adds a redundant dependency on the local snapshot.

## Require

Stop persisting the user session list in runtime.json. Restore sessions from
persisted Telegram bindings and create them as needed during operation. Keep
the session registry in memory. Existing snapshots containing a session list
must remain loadable without relying on that list. Continue loading Telegram
chat settings from Firestore as specified in [TASK-011](closed/TASK-011.md).

## Acceptance

- New runtime snapshots contain no user session list.
- The bot starts with existing snapshots that contain a session list and with
  snapshots that omit it.
- After a restart, users with persisted Telegram bindings can receive messages
  without first contacting the bot again.
- Restoring existing users at startup does not report them as newly joined.
- Normal user interaction still creates sessions when needed.
- Telegram chat settings load from Firestore after a restart.
- Persisted user data is unchanged.
