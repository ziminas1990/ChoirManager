# Task Tracker over Firestore

Status: draft

Related specs:
- specs/spec-1-task-tracker.md

## Problem

The current `TaskTracker` storage uses Google Sheets as its persistent database.

The task database should move to Google Firestore, where each task can be stored as an individual document. Bot is the only writer, so the system no longer needs polling-based change detection. Firestore also removes the need to use `created_at` as an identifier and allows tasks to have an explicit stable id.

## Proposal

Replace the Google Sheets task tracker adapter with a Google Firestore adapter that implements `ITaskTracker`. Google Sheet adapter should be removed from the project completely.

Each task should be stored as a separate Firestore document. The runtime should load all available tasks on startup, keep them in memory, and treat that in-memory snapshot as the authoritative runtime cache. After startup, task changes should flow through explicit bot writes rather than periodic database refreshes.

## Domain Model Changes

### Stable task id

Add a new required field `id` to every task.

`id` becomes the primary task identifier for storage, runtime lookups, events, and tool-facing APIs.

Its format should be:

```text
DDMMYY-XXXX
```

Where:

1. `DDMMYY` is the task creation date portion.
2. `XXXX` is a four-character suffix derived from a random two-byte value.

`id` must be immutable after task creation.

`created_at` should remain part of the task model as a timestamp field, but it is no longer the identifier and must no longer be used to locate or address tasks.

### Task schema version

Add a new required field `schema`.

For this proposal:

1. `schema` defaults to `1` for all newly created tasks.
2. `schema` represents the task document schema version.
3. future schema changes may increment this value when the task shape evolves.

The presence of `schema` allows the storage layer to distinguish task versions explicitly instead of inferring them from field presence.

## `ITaskTracker` Contract Changes

The adapter should remain writable, but identity semantics should move from `created_at` to `id`.

The intended contract is:

```typescript
type NewTaskData = Omit<TaskData, "id" | "schema" | "created_at">;

interface ITaskTracker {
    fetch(filter?: TaskFilter): Promise<Expected<TaskData[]>>;
    create(task: NewTaskData): Promise<Expected<TaskData>>;
    update(task: TaskData): Promise<Expected<TaskUpdate>>;
    delete(task: TaskData): Promise<Expected<TaskData>>;
}
```

Notes:

1. `create` should assign `id`, `schema`, and `created_at`, then return the final persisted task.
2. `update` should use `id` to locate the task in storage.
3. `delete` should use `id` to locate the task in storage.
4. `id`, `schema`, and `created_at` should be treated as immutable once the task is created.

## Firestore Storage Model

The Firestore adapter should store each task as a separate document in a dedicated collection.

The document identity should be based on the task `id`, so storage lookups are direct and do not require scanning by `created_at`.

Each document should contain the full normalized task payload, including:

1. `id`
2. `schema`
3. `created_at`
4. all existing task fields such as author, title, comment, status, deadline, manager, and assignee

## Firestore Adapter Behavior

### Startup load

When the adapter starts:

1. it should read all accessible task documents from Firestore;
2. it should normalize them into `TaskData`;
3. it should build an in-memory cache keyed by `id`.

This initial load replaces the old polling-driven cache warmup model.

### Fetch

`fetch(filter?)` should serve from the in-memory cache.

It may still support filtering by status, but it should not trigger periodic Firestore refreshes and should not depend on a fetch interval. The adapter is not expected to re-read Firestore on every call because the bot is the only writer.

### Create

On task creation:

1. the adapter generates a new `id`;
2. the adapter sets `schema = 1`;
3. the adapter assigns `created_at`;
4. the adapter writes the document to Firestore;
5. if the write succeeds, the adapter reads the stored document back from Firestore;
6. the adapter updates the in-memory cache with the normalized stored document;
7. the adapter returns that final task object.

If a generated `id` collides with an existing document id, the adapter should generate a new suffix and retry before reporting failure.

### Update

On task update:

1. the adapter identifies the target task by `id`;
2. the adapter persists the change to Firestore first;
3. if the write succeeds, the adapter reads the updated document back from Firestore;
4. the adapter replaces the cached task with the fetched stored document;
5. the adapter returns a `TaskUpdate` derived from the previous cached task and the persisted document.

This read-after-write step ensures the cache reflects the canonical stored document rather than a guessed local projection.

### Delete

On task deletion:

1. the adapter identifies the target task by `id`;
2. the adapter deletes the corresponding Firestore document;
3. only after a successful delete does it remove the task from the in-memory cache;
4. it returns the deleted task snapshot.

## `TaskTracker` Runtime Changes

`TaskTracker` should continue to keep an in-memory snapshot and expose imperative write methods, but its storage lifecycle should change in the following ways:

1. the snapshot should be keyed by `id` instead of `created_at`;
2. startup should populate the snapshot from the Firestore adapter's full initial load;
3. `create_task`, `update_task`, and `delete_task` should continue to update local state only after adapter success;
4. no polling loop is required to keep task data synchronized with the database.

The event model should remain imperative:

1. `new_task` is emitted immediately after a successful create;
2. `task_updated` is emitted immediately after a successful update that changed at least one field;
3. `task_deleted` is emitted immediately after a successful delete.

`deadline_notification` logic may remain unchanged, but it should operate on the in-memory snapshot keyed by `id`.

## Configuration Impact

The task tracker database configuration should move away from spreadsheet-specific settings.

This proposal does not define the exact final configuration shape beyond that direction.

## Expected Outcome

After this proposal is implemented, `TaskTracker` will use Firestore as its persistent storage, each task will have a first-class stable `id` and explicit `schema` version, and the runtime will rely on startup hydration plus in-memory state updates instead of polling the database for changes.