# Task Tracker

## Influencing proposals

- `prop-4-tasl-tracker-ai-tool.md` — exposed read-only task queries to the managers agent via `TaskTrackerTools`.
- `prop-5-task-tracker-updates-feature.md` — added task creation, update, and deletion through `ITaskTracker` and `TaskTracker`, plus `task_deleted` events.

## Overview

The task tracker monitors choir tasks and emits events about task changes and upcoming deadlines.

## Domain model

A task has a timestamp (`created_at`), author email, title, optional comment, status, optional deadline, optional manager, and optional assignee.

`created_at` is the task identifier. The adapter assigns it on create and it must not change on update.

Status is one of: pending, in_progress, completed, cancelled. In the sheet these appear as To Do, In Progress, Done, and Cancelled.

Tasks can be filtered by status. A task update records the previous and next task state and lists only the fields that actually changed.

## `ITaskTracker` adapter API

The adapter exposes four operations:

- **fetch** — return tasks, optionally filtered by status. When the fetch interval has expired, read the full sheet and rebuild the cache first.
- **create** — append a new task. The adapter assigns `created_at` and returns the created task.
- **update** — locate a task by `created_at`, persist changes, and return a diff with only changed fields. If nothing changed, return without writing to the sheet.
- **delete** — locate a task by `created_at`, remove it from the sheet, and return the deleted task.

## `TaskTracker` logic

`TaskTracker` is a `Logic` component that:

1. polls the adapter on a fixed interval;
2. keeps its own in-memory snapshot keyed by `created_at`;
3. broadcasts events when polling detects external changes;
4. exposes imperative write methods that delegate to the adapter.

### Polling

On each `proceed()` cycle, `TaskTracker` calls `adapter.fetch()`. When the returned snapshot differs from the local one, it broadcasts:
- `new_task` for tasks that appeared;
- `task_updated` for tasks whose fields changed.

Polling does not detect tasks deleted externally in the sheet.

### Imperative methods

`TaskTracker` also exposes `create_task`, `update_task`, and `delete_task`. Each method calls the adapter, updates the local snapshot only after a successful response, and broadcasts an event immediately without waiting for the next poll.

`update_task` broadcasts only when at least one field changed. `update_task` and `delete_task` require the task to exist in the local snapshot.

### Events

`TaskTracker` emits these event types:

- `new_task` — a task was created or appeared in the sheet
- `task_updated` — one or more fields of an existing task changed
- `task_deleted` — a task was removed
- `deadline_notification` — one or more active tasks have an upcoming deadline

`TaskTracker` does not render or deliver messages. Consumers subscribe to the event broadcaster and handle presentation separately.

`deadline_notification` is emitted only when `enable_notifications` is `true`. Once per UTC day, at `notification_time_utc`, `TaskTracker` collects active tasks (not completed or cancelled) whose deadline falls within `deadline_threshold_days` from now, sorted by deadline ascending. If the list is non-empty, it emits `deadline_notification`.

## `GoogleSheetTaskTracker`

The only `ITaskTracker` implementation uses a Google Spreadsheet as the task database.

### Sheet layout

The spreadsheet contains a single table with these columns:
- "Отметка времени" — timestamp in `"17.06.2026 6:02:34"` format (`created_at`)
- "Адрес электронной почты" — author email address
- "Заголовок" — task title
- "Комментарий" — multiline task comment
- "Статус" — one of `"To Do"`, `"In Progress"`, `"Done"`, or `"Cancelled"`
- "Дедлайн" — timestamp in `"17.06.2026 6:02:34"` format
- "Менеджер" — manager name
- "Исполнитель" — assignee name

Sheet status values are mapped to internal `TaskStatus` values during parsing and back when writing.

### Local cache

Every full `sheet.read()` rebuilds the adapter cache. Each cache entry stores:
- the parsed `TaskData`;
- the 0-based sheet row index.

`fetch()` serves from cache when `fetch_interval_sec` has not elapsed; otherwise it refreshes the cache with a full sheet read.

### Row location

`locate_task(created_at)`:
1. finds the task in the cache and reads its expected row index;
2. fetches only that row from the sheet;
3. verifies the fetched `created_at` matches the expected value;
4. returns the parsed row as `previous` and the row index for write/delete operations.

Write operations call `read_and_update_cache()` before and after mutating the sheet.

## Configuration

The task tracker is optional and is enabled only when configured:

```json
"task_tracker": {
    "database": {
        "type": "google_spreadsheet",
        "spreadsheet_id": "1P1X5cyoODKTaVc86Yuqbv27y9hScdllryRADKr00PhY",
        "sheet_name": "Tasks",
        "fetch_interval_sec": 1800
    },
    "enable_notifications": true,
    "deadline_threshold_days": 5,
    "notification_time_utc": "HH:MM"
}
```

## AI tooling

When both `managers_chat_agent` and `task_tracker` are configured, `ManagersAgent` receives a read-only `TaskTrackerTools` toolchain with a single `get_tasks` tool. It returns tasks as JSON, optionally filtered by status. Task mutations are not exposed through AI tools.
