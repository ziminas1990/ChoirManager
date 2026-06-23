# Enhanced AI Tool for Task Tracker

Status: draft

## Proposed API

The managers' agent should receive a writable `TaskTrackerTools` toolchain when `task_tracker` is configured.

The toolchain should expose:

1. `get_tasks`
2. `create_task`
3. `update_task`
4. `delete_task`

## Goals

The existing read-only tool is enough to answer questions about current tasks, but it does not let the bot execute explicit operational requests from managers.

After this proposal is implemented, managers should be able to ask the bot to:

1. create a task;
2. assign or reassign a task;
3. change status, deadline, title, or comment;
4. delete a task.

## Tool Contract

### `get_tasks`

`get_tasks` keeps the current behavior and still supports an optional `status` filter.

Its response should include a stable `task_id` for every task:

```json
{
  "tasks": [
    {
      "task_id": "1718593354000",
      "created_at": "2026-06-17T03:02:34.000Z",
      "author_email": "someone@example.com",
      "title": "Prepare sheet music",
      "comment": "Print new copies",
      "status": "pending",
      "deadline": "2026-06-20T18:00:00.000Z",
      "manager": "Anna",
      "assignee": "Ivan"
    }
  ]
}
```

`task_id` is derived from `created_at` and exists only for AI-tool convenience.

### `create_task`

`create_task` accepts a task payload similar to `NewTaskData`:

1. `title` is required;
2. `status` is optional and defaults to `pending`;
3. `author_email` is optional for managers chat requests and may fall back to a synthetic managers-agent author value;
4. `comment`, `deadline`, `manager`, and `assignee` are optional.

It returns the created task.

### `update_task`

`update_task` should be patch-style rather than full-object style, because the LLM usually needs to change only one or two fields.

The tool accepts:

1. `task_id` — required;
2. any writable task fields as optional patch fields.

Rules:

1. the tool resolves the current task by `task_id`;
2. it merges the provided patch into the stored task;
3. it calls `TaskTracker.update_task(...)` with the resulting full object;
4. optional fields `comment`, `deadline`, `manager`, and `assignee` may be cleared by passing `null`;
5. the response should include `changed: boolean`, `updated_fields`, and the final task snapshot.

If no actual field values changed, `changed` must be `false`.

### `delete_task`

`delete_task` accepts `task_id`, resolves the stored task, calls `TaskTracker.delete_task(...)`, and returns the deleted task.

## Managers Agent Behavior

The managers' prompt should explicitly instruct the LLM that:

1. explicit task-management requests must use the task tracker tools;
2. `get_tasks` should be used first when the target task must be identified;
3. ambiguous requests must trigger a clarifying question instead of a guessed mutation;
4. after successful `create_task` or `delete_task`, and after successful `update_task` with `changed: true`, the agent should not send a duplicate confirmation message because the task tracker event will appear automatically in the chat;
5. if an update request results in no changes, the agent should send a short explanatory message because no event will be emitted;
6. if a task tool call fails, the agent should send a short error message to the managers chat and include the failure reason.

## Expected Outcome

The managers' chat agent becomes operational rather than read-only: it can inspect tasks, mutate them safely through the existing `TaskTracker` write API, and rely on the normal task event pipeline for visible confirmations.

