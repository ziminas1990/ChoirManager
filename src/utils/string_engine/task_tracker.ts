import { TaskData, TaskStatus, TaskUpdate } from "@src/entities/task.js";
import { TaskTrackerEvent } from "@src/interfaces/task_tracker_service.js";
import { html_text } from "@src/utils.js";

type TaskField = Exclude<keyof TaskData, "id" | "schema" | "created_at">;

type ChangedField = {
    field: TaskField;
    old_value?: string;
    new_value?: string;
    multiline: boolean;
};

function format_status(status: TaskStatus): string {
    switch (status) {
        case "pending":
            return "To Do";
        case "in_progress":
            return "In Progress";
        case "completed":
            return "Done";
        case "cancelled":
            return "Cancelled";
    }
}

function field_label(field: TaskField): string {
    switch (field) {
        case "author":
            return "Автор";
        case "title":
            return "Заголовок";
        case "comment":
            return "Комментарий";
        case "status":
            return "Статус";
        case "deadline":
            return "Дедлайн";
        case "manager":
            return "Менеджер";
        case "assignee":
            return "Исполнитель";
    }
}

function is_multiline_field(field: TaskField): boolean {
    return field === "comment";
}

function pad_2(value: number): string {
    return value.toString().padStart(2, "0");
}

function format_date(date: Date): string {
    return `${pad_2(date.getDate())}.${pad_2(date.getMonth() + 1)}.${date.getFullYear()}`;
}

function format_datetime(date: Date): string {
    return [
        format_date(date),
        `${pad_2(date.getHours())}:${pad_2(date.getMinutes())}:${pad_2(date.getSeconds())}`,
    ].join(" ");
}

function days_left(deadline: Date, now: Date): number {
    return Math.ceil((deadline.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

function format_task_value(field: keyof TaskData, value: TaskData[keyof TaskData] | undefined): string | undefined {
    if (value == undefined) {
        return undefined;
    }
    if (field === "status") {
        return format_status(value as TaskStatus);
    }
    if (field === "deadline") {
        return format_date(value as Date);
    }
    if (value instanceof Date) {
        return format_datetime(value);
    }
    return String(value);
}

function bold(text: string): string {
    return `<b>${html_text(text)}</b>`;
}

function collect_changes(update: TaskUpdate): ChangedField[] {
    const fields: TaskField[] = [
        "author",
        "status",
        "deadline",
        "manager",
        "assignee",
        "comment",
    ];
    const changes: ChangedField[] = [];

    for (const field of fields) {
        const entry = update.updates[field];
        if (!entry) {
            continue;
        }

        const old_value = format_task_value(field, entry.previous);
        const new_value = format_task_value(field, entry.next);
        if (old_value === new_value) {
            continue;
        }

        changes.push({
            field,
            old_value,
            new_value,
            multiline: is_multiline_field(field),
        });
    }

    return changes;
}

function format_new_task_message(task: TaskData, now: Date): string {
    const lines: string[] = [
        "Создана новая задача:",
        "",
        `${bold("Автор:")} ${html_text(task.author)}`,
        `${bold("Заголовок:")} ${html_text(task.title)}`,
    ];

    if (task.deadline) {
        lines.push(
            `${bold("Дедлайн:")} ${html_text(format_date(task.deadline))} (${days_left(task.deadline, now)} дней)`,
        );
    }
    if (task.manager) {
        lines.push(`${bold("Менеджер:")} ${html_text(task.manager)}`);
    }
    if (task.assignee) {
        lines.push(`${bold("Исполнитель:")} ${html_text(task.assignee)}`);
    }
    if (task.comment) {
        lines.push("", `${bold("Комментарий:")}`, html_text(task.comment));
    }

    return lines.join("<br>");
}

function format_task_update_message(updates: TaskUpdate[]): string {
    const lines = ["Задача обновлена:", ""];

    for (const update of updates) {
        const old_title = html_text(update.previous.title);
        const new_title = html_text(update.next.title);
        if (update.previous.title === update.next.title) {
            lines.push(`${bold("Заголовок:")} ${new_title}`);
        } else {
            lines.push(`${bold("Заголовок:")} ${old_title} -&gt; ${new_title}`);
        }

        const changes = collect_changes(update);
        for (const change of changes) {
            const label = `${bold(`${field_label(change.field)}:`)}`;
            const new_value = html_text(change.new_value ?? "(empty)");

            if (change.multiline) {
                lines.push(label, new_value);
                continue;
            }

            if (change.old_value == undefined || change.old_value.length === 0) {
                lines.push(`${label} ${new_value}`);
                continue;
            }

            if (change.new_value == undefined || change.new_value.length === 0) {
                lines.push(`${label} (empty)`);
                continue;
            }

            if (change.old_value === change.new_value) {
                lines.push(`${label} ${new_value}`);
                continue;
            }

            lines.push(`${label} ${html_text(change.old_value)} -&gt; ${new_value}`);
        }

        lines.push("");
    }

    if (lines[lines.length - 1] === "") {
        lines.pop();
    }

    return lines.join("<br>");
}

function format_deadline_message(tasks: TaskData[], now: Date): string {
    const lines: string[] = [
        `У ${tasks.length} задач скоро наступает дедлайн!`,
        "",
    ];

    tasks.forEach((task, idx) => {
        if (idx > 0) {
            lines.push("");
        }

        lines.push(`${bold("Заголовок:")} ${html_text(task.title)}`);
        if (task.manager) {
            lines.push(`${bold("Менеджер:")} ${html_text(task.manager)}`);
        }
        if (task.deadline) {
            lines.push(
                `${bold("Дедлайн:")} ${html_text(format_date(task.deadline))} (${days_left(task.deadline, now)} days left)`,
            );
        }
    });

    return lines.join("<br>");
}

function format_task_deleted_message(task: TaskData): string {
    const lines: string[] = [
        "Задача удалена:",
        "",
        `${bold("Заголовок:")} ${html_text(task.title)}`,
    ];

    if (task.manager) {
        lines.push(`${bold("Менеджер:")} ${html_text(task.manager)}`);
    }
    if (task.assignee) {
        lines.push(`${bold("Исполнитель:")} ${html_text(task.assignee)}`);
    }

    return lines.join("<br>");
}

export function render_task_tracker_event(event: TaskTrackerEvent, now: Date): string {
    switch (event.what) {
        case "new_task":
            return format_new_task_message(event.task, now);
        case "task_updated":
            return format_task_update_message(event.update);
        case "task_deleted":
            return format_task_deleted_message(event.task);
        case "deadline_notification":
            return format_deadline_message(event.tasks, now);
    }
}
