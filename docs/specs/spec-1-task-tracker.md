# Minimal Task Tracker Proposal

## Problem

The bot should track all active tasks and send reminder messages containing the current list of active tasks.

## Behavior

### New Task Notification

When the bot detects a new task, it must send a notification to the managers' chat in the following format:

```
Создана новая задача:

Автор: <author_email>
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

### Task Update Notification

When the bot detects that an existing task has been updated, it must send a notification to the managers' chat in the following format:

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

### Deadline Notification

If `enable_notifications` is `true`, the bot should send notifications about tasks with upcoming deadlines.

Every day at `notification_time_utc` (UTC), the bot should iterate through all tasks and build a list `L` of active tasks that:
- are not in `Done` or `Cancelled` status;
- have a deadline;
- have a deadline less than `deadline_threshold_days` days from the current time.

If `L` is not empty, the bot must send a message to the managers' chat in the following format:

```
У {N} задач скоро наступает дедлайн!

<tasks>
```

`<tasks>` is a list of tasks formatted as follows:

```
title: <title>
manager: <manager>
deadline: <deadline> (N days left)
```

The list must be sorted by deadline in ascending order.

## Implementation Details

Introduce a new `TaskData` entity to represent a task.

Use Google Sheets as the task database. The spreadsheet should contain a single table with the following columns:
- "Отметка времени" - timestamp in the `"17.06.2026 6:02:34"` format
- "Адрес электронной почты" - author email address
- "Заголовок" - task title
- "Комментарий" - multiline task comment
- "Статус" - one of `"To Do"`, `"In Progress"`, `"Done"`, or `"Cancelled"`
- "Дедлайн" - timestamp in the `"17.06.2026 6:02:34"` format
- "Менеджер" - manager name
- "Исполнитель" - assignee name

If `TaskData.status` uses normalized internal values, the Google Sheets status values must be mapped to those internal values during parsing.

An `ITaskTracker` interface should be introduced. For now, it should expose only one method, `fetch`, which returns tasks optionally filtered by `TaskFilter`. Initially, there should be a single implementation, `GoogleSheetTaskTracker`, which polls the spreadsheet every `N` seconds and stores the parsed tasks in memory.

## Configuration

The task tracker is an optional module and should be enabled only when it is configured:

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

## AI Tooling

Task Tracker provides an implementation of the `IToolchain` interface, that allows LLM to fetch tasks from the database.

```typescript

type TaskFilter = {
    status?: TaskStatus[];
}

interface TaskTrackerTool {
    get_tasks(filter: TaskFilter): Promise<string>;
}
```

### get_tasks()

`get_tasks()` method returns a stringified JSON array of tasks or an error message.

```typescript
type Response = {
    tasks: TaskData[];
} | {
    error: string;
}
```