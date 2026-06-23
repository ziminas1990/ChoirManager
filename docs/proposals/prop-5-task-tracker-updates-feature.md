# Task Tracker Updates Feature

Status: implemented

Related specs:
- specs/spec-1-task-tracker.md

## Problem

The codebase already has the following pieces:

1. `TaskTracker`, which keeps an in-memory snapshot of tasks and broadcasts task events.
2. `ITaskTracker`, which currently exposes only `fetch(filter?)`.
3. `TaskTrackerTools`, which currently allows the managers' agent to read tasks.
4. `ManagersAgent`, which can already answer questions about tasks when it has read access.

This is enough for passive monitoring, but not enough for operational work in the managers' chat.

At the moment, the bot cannot perform requests such as:

1. create a new task from a manager message;
2. assign an existing task to someone;
3. change a deadline or comment;
4. mark a task as `completed` or `cancelled`.

As a result, managers still need to open the task database manually even when the request is explicit and safe for the bot to execute.

## Proposal

The bot should be able to create new tasks and update existing tasks through `TaskTracker`.

This proposal extends the task tracker storage and runtime logic to support write operations.

The bot should support:

1. `create`
2. `update`
3. `delete`

## Adapter API

The current `fetch` contract should be preserved, but `ITaskTracker` should become writable.

```typescript
type NewTaskData = Omit<TaskData, "created_at">;

interface ITaskTracker {
    fetch(filter?: TaskFilter): Promise<Expected<TaskData[]>>;
    create(task: NewTaskData): Promise<Expected<TaskData>>;
    update(task: TaskData): Promise<Expected<TaskUpdate>>;
    delete(task: TaskData): Promise<Expected<TaskData>>;
}
```

Notes:

1. `create` should return the created `TaskData`, including the generated `created_at`, because `created_at` is currently used as the task identifier.
2. `update` should accept the full `TaskData` object and use `created_at` to locate the stored task.
3. `update` should return `TaskUpdate` containing only the fields that actually changed.
4. `delete` should accept the full `TaskData` object and use `created_at` to locate the stored task to delete.
5. `delete` should return the deleted `TaskData`.
6. `created_at` must remain immutable.

## Behavior Requirements

### Create

After a successful create:

1. the new task must be persisted to the task database;
2. `TaskTracker` must update its in-memory snapshot immediately;
3. a `new_task` event should be broadcast using the same event pipeline as externally detected tasks.

### Update

After a successful update:

1. the target task must be located by `created_at`;
2. the adapter should compare the stored task with the provided full object and detect which fields actually changed;
3. `TaskTracker` must update its in-memory snapshot immediately;
4. a `task_updated` event should be broadcast using the same diff format as polling-based updates.

### Delete

After a successful delete:

1. the target task must be located by `created_at`;
2. the task must be removed from the task database;
3. `TaskTracker` must remove the task from its in-memory snapshot immediately;
4. a dedicated task deletion event should be broadcast without waiting for the next polling cycle.

## Implementation Details

### 1. Extend `ITaskTracker` implementations

The concrete task tracker adapter, currently the Google Sheets implementation, should support:

1. appending a new row for `create`;
2. locating the existing row by `created_at` for `update`;
3. locating the existing row by `created_at` for `delete`;
4. returning the final normalized `TaskData` after the write.

Because the current task identifier is derived from `created_at`, the adapter must preserve that value exactly during updates.

### 2. Add imperative methods to `TaskTracker`

`TaskTracker` should not remain read-only if the bot is expected to mutate tasks. It should expose high-level methods such as:

1. `create_task(...)`
2. `update_task(task: TaskData)`
3. `delete_task(task: TaskData)`

These methods should:

1. call the adapter write methods;
2. update the local snapshot immediately only if the adapter confirmed the write operation.
3. broadcast `new_task`, `task_updated`, or a dedicated deletion event without waiting for the next polling cycle only if the adapter returned `ok`.

This is important to avoid delayed confirmations and duplicate or confusing notifications after the next `fetch()`.

## Expected Outcome

After this proposal is implemented, the task tracker subsystem will support task creation, full-object updates, and deletions with consistent event generation.