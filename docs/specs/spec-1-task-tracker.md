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

## `ITaskTracker` API

`ITaskTracker` exposes four operations:

- **fetch** — return tasks, optionally filtered by status.
- **create** — create a task and return the persisted result.
- **update** — persist task changes and return a diff with only changed fields. If nothing changed, return without writing.
- **delete** — delete a task and return the deleted task snapshot.

The Firestore adapter implements this interface against the database. `TaskTracker` logic also implements the same interface as a facade over its in-memory snapshot and the adapter.

Consumers access the runtime tracker through `TaskTrackerInstance`. Runtime registers the logic instance with `TaskTrackerInstance.set_instance(...)` after a successful `init()`. Call sites use `TaskTrackerInstance.has_instance()` / `TaskTrackerInstance.get_instance()` instead of receiving the tracker through dependency injection.

## `TaskTracker` logic

`TaskTracker` is a `Logic` component that implements `ITaskTracker` and:

1. hydrates its in-memory snapshot from the adapter on startup;
2. keeps the snapshot keyed by `id` as the authoritative runtime cache;
3. serves `fetch()` from that snapshot without calling the adapter;
4. implements `create`, `update`, and `delete` by delegating to the adapter;
5. broadcasts events immediately after successful writes.

`TaskTracker` does not poll the database for external changes.

### Startup

On `init()`, `TaskTracker` calls `adapter.fetch()` to load the initial snapshot and may emit a `deadline_notification` on the same schedule as during normal operation. After init succeeds, Runtime registers the tracker in `TaskTrackerInstance`.

### Imperative methods

`TaskTracker` exposes `create`, `update`, and `delete` from `ITaskTracker`. Each method calls the adapter, updates the local snapshot only after a successful response, and broadcasts an event immediately.

`update` broadcasts only when at least one field changed. `update` and `delete` require the task to exist in the local snapshot.

### Periodic processing

On each `proceed()` cycle, `TaskTracker` checks whether a `deadline_notification` should be sent. It does not refresh task data from the adapter.

### Events

`TaskTracker` emits these event types:

- `new_task` — a task was created
- `task_updated` — one or more fields of an existing task changed
- `task_deleted` — a task was removed
- `deadline_notification` — one or more active tasks have an upcoming deadline

`TaskTracker` does not render or deliver messages. Consumers subscribe to the event broadcaster and handle presentation separately.

`deadline_notification` is emitted only when `enable_notifications` is `true`. Once per UTC day, at `notification_time_utc`, `TaskTracker` collects active tasks (not completed or cancelled) whose deadline is exactly N whole days away for any N in `deadline_notification_days`, sorted by deadline ascending. If the list is non-empty, it emits `deadline_notification`.

## `GoogleFirestoreTaskTracker`

The Firestore adapter is the persistence `ITaskTracker` implementation. It stores each task as a separate Firestore document.

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
    "notification_time_utc": "HH:MM",
    "deadline_notification_days": [3, 1]
}
```

## AI tooling

When both `managers_chat_agent` and `task_tracker` are configured, `ManagersAgent` receives a writable `TaskTrackerTools` toolchain.

It exposes:

- `get_opened_tasks` — returns open tasks (`pending`, `in_progress`) as JSON. Each task also includes a tool-facing `task_id` equal to the task `id`. This is the default listing tool, including when the user says "show all tasks".
- `get_all_tasks` — returns tasks including closed ones when no status filter is set. Accepts an optional `status` filter. Rejects the request if more than 50 tasks match. Used when the user explicitly asks to include completed/cancelled tasks, or asks about tasks that were changed or worked on.
- `create_task` — creates a task through `TaskTracker.create(...)`.
- `update_task` — applies a partial patch to a task identified by `task_id`, then delegates to `TaskTracker.update(...)`.
- `delete_task` — deletes a task identified by `task_id` through `TaskTracker.delete(...)`.

`task_id` is for tool use only. The agent must not show it to the user unless the user explicitly asked for task ids.
