# Task Tracker

## Influencing proposals

- `prop-4-tasl-tracker-ai-tool.md` — exposed read-only task queries to the managers agent via `TaskTrackerTools`.
- `prop-5-task-tracker-updates-feature.md` — added task creation, update, and deletion through `ITaskTracker` and `TaskTracker`, plus `task_deleted` events.
- `prop-7-task-tracker-over-firestore.md` — moved persistent storage from Google Sheets to Firestore, introduced stable task `id` and `schema`, and removed polling-based synchronization.

## Overview

The task tracker monitors choir tasks and emits events about task changes and upcoming deadlines.

The bot is the only writer to the task database. The runtime loads all tasks on startup, keeps an in-memory snapshot, and updates that snapshot only through explicit adapter writes.

## Domain model

A task has:

- `id` — stable identifier in `DDMMYY-XXXX` format, where `DDMMYY` is the creation date and `XXXX` is a four-character hex suffix derived from random bytes;
- `schema` — task document schema version (currently `1` for all newly created tasks);
- `created_at` — creation timestamp;
- `author`;
- `title`;
- optional `comment`;
- `status`;
- optional `deadline`;
- optional `manager`;
- optional `assignee`.

`id`, `schema`, and `created_at` are assigned on create and must not change on update.

`id` is the primary task identifier for storage, runtime lookups, events, and tool-facing APIs.

Status is one of: `pending`, `in_progress`, `completed`, `cancelled`.

Tasks can be filtered by status. A task update records the previous and next task state and lists only the fields that actually changed.

## `ITaskTracker` adapter API

The adapter exposes four operations:

- **fetch** — read all task documents from Firestore, normalize them, and return the result, optionally filtered by status.
- **create** — generate `id`, `schema`, and `created_at`, write the document to Firestore, read it back, and return the persisted task.
- **update** — read the stored task by `id`, persist changes to Firestore, read the stored document back, and return a diff with only changed fields. If nothing changed, return without writing to Firestore.
- **delete** — read the stored task by `id`, delete the Firestore document, and return the deleted task snapshot.

## `TaskTracker` logic

`TaskTracker` is a `Logic` component that:

1. hydrates its in-memory snapshot from the adapter on startup;
2. keeps the snapshot keyed by `id` as the authoritative runtime cache;
3. serves `get_tasks()` from that snapshot without calling the adapter;
4. exposes imperative write methods that delegate to the adapter;
5. broadcasts events immediately after successful writes.

`TaskTracker` does not poll the database for external changes.

### Startup

On `init()`, `TaskTracker` calls `adapter.fetch()` to load the initial snapshot and may emit a `deadline_notification` on the same schedule as during normal operation.

### Imperative methods

`TaskTracker` exposes `create_task`, `update_task`, and `delete_task`. Each method calls the adapter, updates the local snapshot only after a successful response, and broadcasts an event immediately.

`update_task` broadcasts only when at least one field changed. `update_task` and `delete_task` require the task to exist in the local snapshot.

### Periodic processing

On each `proceed()` cycle, `TaskTracker` checks whether a `deadline_notification` should be sent. It does not refresh task data from the adapter.

### Events

`TaskTracker` emits these event types:

- `new_task` — a task was created
- `task_updated` — one or more fields of an existing task changed
- `task_deleted` — a task was removed
- `deadline_notification` — one or more active tasks have an upcoming deadline

`TaskTracker` does not render or deliver messages. Consumers subscribe to the event broadcaster and handle presentation separately.

`deadline_notification` is emitted only when `enable_notifications` is `true`. Once per UTC day, at `notification_time_utc`, `TaskTracker` collects active tasks (not completed or cancelled) whose deadline falls within `deadline_threshold_days` from now, sorted by deadline ascending. If the list is non-empty, it emits `deadline_notification`.

## `GoogleFirestoreTaskTracker`

The only `ITaskTracker` implementation stores each task as a separate Firestore document.

### Firestore layout

Each document is stored in the configured collection. The document id equals the task `id`.

Each document contains the full normalized task payload:

- `id`
- `schema`
- `created_at`
- `author`
- `title`
- `comment`
- `status`
- `deadline`
- `manager`
- `assignee`

Optional fields are stored as `null` when absent.

### Create

On create, the adapter:

1. generates a new `id`;
2. sets `schema = 1`;
3. assigns `created_at`;
4. writes the document to Firestore;
5. reads the stored document back;
6. returns the persisted task.

If a generated `id` collides with an existing document id, the adapter generates a new suffix and retries before reporting failure.

### Update and delete

On update, the adapter reads the stored task from Firestore, persists the change, reads the updated document back, and returns a `TaskUpdate` derived from the previous and persisted documents.

On delete, the adapter reads the stored task from Firestore, deletes the document, and returns the deleted task snapshot.

## Configuration

The task tracker is optional and is enabled only when configured:

```json
"task_tracker": {
    "database": {
        "type": "google_firestore",
        "database_id": "ursa-major-db-test",
        "collection_name": "tasks"
    },
    "enable_notifications": true,
    "deadline_threshold_days": 5,
    "notification_time_utc": "HH:MM"
}
```

## AI tooling

When both `managers_chat_agent` and `task_tracker` are configured, `ManagersAgent` receives a writable `TaskTrackerTools` toolchain.

It exposes:

- `get_tasks` — returns tasks as JSON, optionally filtered by status. Each task also includes a tool-facing `task_id` equal to the task `id`.
- `create_task` — creates a task through `TaskTracker.create_task(...)`.
- `update_task` — applies a partial patch to a task identified by `task_id`, then delegates to `TaskTracker.update_task(...)`.
- `delete_task` — deletes a task identified by `task_id` through `TaskTracker.delete_task(...)`.
