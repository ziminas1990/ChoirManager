# Managers Agent Specification

Proposals history:
- [Proposal 3: Managers Chat Agent](../proposals/prop-3-managers-chat-agent.md)

## What is the Managers Agent?

The Managers Agent is an AI agent that keeps all messages from the managers' chat from the last `N` days in its context. Each message in the context includes the following data:

1. id: string with the message id
2. time: string in `DD.MM, HH:MM` format
3. author: string in `Name (@telegram_username)` format
4. text: string with the message text

If the message was sent by the bot itself, it must also be included in the context with `Ursa Major Bot` as the author.

`ManagersAgent` should call the LLM only if the bot was mentioned in the message. The mention string is derived from `tg_adapter.bot_id`.

## Behavior

If the agent receives a message and invokes the LLM, it should send a `Typing` action to the managers' chat while the response is being generated.

The agent should send the LLM response to the managers' chat and add that response to both:

1. the agent context
2. the managers' chat backlog

The agent can send visible messages only by calling the Messenger tool.

Messages sent to the managers' chat by other bot components must also be added to the managers' chat backlog and to the agent context as bot-authored messages.

## Configuration

The managers' agent should be configured as follows:

```json
"managers_chat_agent": {
    "model": "gpt-5.4-mini",
    "context_days": 14,
    "prompt_file": "./config/managers_chat_agent_prompt.txt"
}
```

Additional requirements:

1. `openai_api_key_file` must be configured.
2. `tg_adapter.bot_id` must be configured so the bot mention can be detected.
3. `managers_chat.backlog` must be configured because the agent loads historical context from it.

## Implementation Details

The bot already forwards new messages from the managers' chat to `GroupChat`, which stores them in the backlog. However, the managers' chat did not previously have a dedicated AI entity.

We introduce a new `ManagersAgent` class. It receives:

1. the managers' `GroupChat`
2. the `managers_chat_agent` configuration
3. a way to send messages back to the managers' chat
4. a way to resolve user IDs into display names

`ManagersAgent` constructs an `Agent` instance with a retention time equal to `context_days` days. All new messages from the managers' chat are added to the agent's context.

When `ManagersAgent` is created, it must fetch all messages from the last `context_days` days from the managers' chat backlog and preload them into the agent context in chronological order.

When the bot sends a new message through the Messenger tool, that outgoing message must also be recorded in the backlog so that it is preserved across restarts.

The same applies to messages posted by other bot components in response to task tracker events: they must also be recorded in the backlog and added to the agent context.

When the managers' agent has access to `TaskTrackerTools`, it should use them for explicit task-management requests such as creating, reassigning, rescheduling, completing, cancelling, editing, or deleting tasks. If the target task is ambiguous, it should ask a clarifying question instead of mutating the wrong task.

## Task tracker events

`ManagersAgent` subscribes to `TaskTracker` events. For each event it calls `render_task_tracker_event` in the string engine to produce HTML, then posts the result to the managers' chat.

If the agent itself triggered a successful task mutation through `TaskTrackerTools`, it should normally rely on this event pipeline as the visible confirmation instead of sending an extra duplicate success message. A direct explanatory message is still appropriate when no mutation happened, for example because an update request produced no actual field changes.

If a `TaskTrackerTools` call fails, the failure is visible to the agent as a tool error. In that case the agent should send a short message to the managers' chat saying that the request could not be completed and include the error reason.

### New task

On `new_task`, the rendered message looks like:

```
Создана новая задача:

Автор: <author>
Заголовок: <title>
Дедлайн: <deadline> (N дней)
Менеджер: <manager>
Исполнитель: <assignee>

Комментарий:
<multiline comment>
```

Rules:
1. All field names must be bold.
2. Any field with an empty value must be omitted.

### Task update

On `task_updated`, the rendered message looks like:

```
Задача обновлена:

<changes>
```

`<changes>` is a list of changed fields formatted as follows.

Fields that were previously empty and now have a value:

```
field_name: <new_value>
```

Fields whose value changed:

```
field_name: <old_value> -> <new_value>
```

Fields whose value was deleted:

```
field_name: (empty)
```

Rules:
1. The `title` field must always be included as the first field, even if it did not change.
2. Multiline fields such as `comment` must always use the `field_name: <new_value>` format, even if they previously had a value.
3. Unchanged fields must be omitted, except for `title`.

### Task deletion

On `task_deleted`, the rendered message looks like:

```
Задача удалена:

Заголовок: <title>
Менеджер: <manager>
Исполнитель: <assignee>
```

Rules:
1. All field names must be bold.
2. `title` is always included.
3. `manager` and `assignee` are included only when present.

### Deadline notification

`TaskTracker` emits `deadline_notification` only when a task deadline is exactly 7, 3, or 1 whole days away.

On `deadline_notification`, the rendered message looks like:

```
У {N} задач скоро наступает дедлайн!

<tasks>
```

Each task in `<tasks>` is formatted as:

```
title: <title>
manager: <manager>
deadline: <deadline> (N days left)
```

The list is sorted by deadline in ascending order.
