# TASK-016: Add a structured activity journal for user changes with JSONL storage

## Background

The application has diagnostic logs but no dedicated history of meaningful user
changes. A structured activity journal is needed so these changes can later be
presented as a readable history independently of technical logs.

## Require

Introduce an asynchronous `IActivityJournal` abstraction for recording activity
events. Follow the project's service, storage, and factory boundaries, with an
initial JSONL file storage adapter and a configurable destination path.

Define a versioned, serializable event contract with:

- An explicit schema identifier and version.
- An event type that determines the event-specific payload shape.
- Common metadata identifying the event, its timestamp, the affected user, and
  the initiating actor or system source.
- Event-specific data describing creation, changed values, or removal.

Limit the initial event catalog and integration to user creation, update, and
removal. Cover successful mutations through existing application entry points,
including automatic user creation. Preserve the distinction between removing
membership and deleting a user record: the current membership-removal operation
must be described accurately and does not require introducing hard deletion.

Store structured facts rather than preformatted human-readable messages. Keep
existing diagnostic logging separate from the activity journal.

## Acceptance

- Callers record typed events through `IActivityJournal` without depending on
  JSONL or filesystem details.
- Each record contains the schema identifier and version, event type, and common
  metadata. Its payload conforms to the contract for that event type.
- Successful user creation, update, and membership removal produce the
  corresponding events with sufficient data to understand what changed.
- Pending, rejected, cancelled, or failed user mutations do not produce success
  events. A membership removal does not also appear as a duplicate generic user
  update for the same operation.
- The configured JSONL file contains one complete JSON object per line. New
  events append without overwriting earlier records, including after restart.
- Concurrent journal writes preserve valid, separate JSONL records. Storage
  failures are surfaced through the application's error handling rather than
  silently ignored.
- Only user lifecycle events are integrated in this task; a journal viewer and
  notification delivery are outside its scope.
