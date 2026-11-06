# TASK-011: Persist dynamic Telegram settings in Firestore

## Background

Telegram chat settings currently survive restarts only through runtime.json.
Losing the local snapshot loses configured routing, even though users and
Telegram bindings remain in Firestore. These settings are durable bot state
and need storage independent of the local runtime snapshot.

## Require

Use a Firestore collection named runtime for dynamic bot settings that must
survive restarts. Store Telegram adapter settings in its tg_adapter_data
document, including:

- choir_chat_id
- announce_thread_id
- managers_chat_id

Load these settings at startup and persist changes when they are made. Move
existing settings from runtime.json without overwriting settings already
stored in Firestore. Keep access within the project's storage and service
boundaries, with an explicitly configured database.

This complements [TASK-010](TASK-010.md): after both changes, the bot must no
longer depend on runtime.json to restore sessions or Telegram settings.

## Acceptance

- Configuring a Telegram chat or announcement thread updates
  runtime/tg_adapter_data in the configured Firestore database.
- A confirmed settings change survives an immediate restart without waiting
  for a local runtime dump.
- After settings have been migrated, the bot restores configured chat routing
  even when runtime.json is absent.
- Existing local chat settings can be migrated without resetting configured
  chats; repeating the migration preserves newer Firestore settings.
- New local snapshots are no longer the persistence source for these settings.
- Failed reads do not silently reset saved settings, and failed writes are
  reported without confirming that a change was saved.
- Local migration and validation use only ursa-major-db-test and leave
  production databases untouched.
