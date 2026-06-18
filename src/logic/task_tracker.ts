import { TaskTrackerConfig } from "@src/config.js";
import { TaskData, TaskStatus } from "@src/entities/task.js";
import { IAdapter } from "@src/interfaces/adapter.js";
import { ITaskTracker } from "@src/interfaces/task_tracker.js";
import { Journal } from "@src/journal.js";
import { Logic } from "@src/logic/abstracts.js";
import { Expected, Status } from "@src/utils/expected.js";

type TaskField = Exclude<keyof TaskData, "created_at">;

type ChangedField = {
    field: TaskField;
    old_value?: string;
    new_value?: string;
    multiline: boolean;
}

function escape_html(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function pad_2(value: number): string {
    return value.toString().padStart(2, "0");
}

function format_datetime(date: Date): string {
    return [
        `${pad_2(date.getDate())}.${pad_2(date.getMonth() + 1)}.${date.getFullYear()}`,
        `${pad_2(date.getHours())}:${pad_2(date.getMinutes())}:${pad_2(date.getSeconds())}`,
    ].join(" ");
}

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
        case "author_email":
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

function get_task_id(task: TaskData): string {
    return task.created_at.getTime().toString();
}

function get_field_value(task: TaskData, field: TaskField): string | undefined {
    switch (field) {
        case "author_email":
            return task.author_email;
        case "title":
            return task.title;
        case "comment":
            return task.comment;
        case "status":
            return format_status(task.status);
        case "deadline":
            return task.deadline ? format_datetime(task.deadline) : undefined;
        case "manager":
            return task.manager;
        case "assignee":
            return task.assignee;
    }
}

function is_multiline_field(field: TaskField): boolean {
    return field === "comment";
}

function task_changed(left: TaskData, right: TaskData): boolean {
    const fields: TaskField[] = [
        "author_email",
        "title",
        "comment",
        "status",
        "deadline",
        "manager",
        "assignee",
    ];

    return fields.some(field => get_field_value(left, field) !== get_field_value(right, field));
}

function is_active(task: TaskData): boolean {
    return task.status !== "completed" && task.status !== "cancelled";
}

function utc_day_key(now: Date): string {
    return [
        now.getUTCFullYear(),
        pad_2(now.getUTCMonth() + 1),
        pad_2(now.getUTCDate()),
    ].join("-");
}

function days_left(deadline: Date, now: Date): number {
    return Math.ceil((deadline.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

export class TaskTracker extends Logic<void> {
    private readonly journal: Journal;

    private fetch_promise?: Promise<void>;
    private initialized = false;
    private tasks: Map<string, TaskData> = new Map();
    private last_deadline_notification_day?: string;

    constructor(
        private readonly config: TaskTrackerConfig,
        private readonly tracker: ITaskTracker,
        private readonly get_adapters: () => IAdapter[],
        parent_journal: Journal,
    ) {
        super(5000);
        this.journal = parent_journal.child("task_tracker_logic");
    }

    async init(now: Date = new Date()): Promise<Status> {
        const tasks_status = await this.tracker.fetch_all();
        if (!tasks_status.ok) {
            return tasks_status.wrap_error("failed to fetch tasks");
        }

        this.update_snapshot(tasks_status.value);
        this.initialized = true;

        const deadline_status = await this.maybe_send_deadline_notification(now, tasks_status.value);
        if (!deadline_status.ok) {
            this.journal.log().warn(`Failed to send deadline notifications: ${deadline_status.error}`);
        }

        return Expected.ok(undefined);
    }

    protected async proceed_impl(now: Date): Promise<Expected<void[]>> {
        if (this.fetch_promise) {
            return Expected.ok([]);
        }

        this.fetch_promise = new Promise((resolve) => {
            void (async () => {
                const status = await this.refresh(now);
                if (!status.ok) {
                    this.journal.log().error(`Task tracker refresh failed: ${status.error}`);
                }
                this.fetch_promise = undefined;
                resolve();
            })();
        });

        return Expected.ok([]);
    }

    private async refresh(now: Date): Promise<Status> {
        const tasks_status = await this.tracker.fetch_all();
        if (!tasks_status.ok) {
            return tasks_status.wrap_error("failed to fetch tasks");
        }

        const next_tasks = tasks_status.value;
        if (this.initialized) {
            const notify_status = await this.notify_about_changes(next_tasks, now);
            if (!notify_status.ok) {
                return notify_status.wrap_error("failed to notify about task changes");
            }
        } else {
            this.initialized = true;
        }

        this.update_snapshot(next_tasks);

        const deadline_status = await this.maybe_send_deadline_notification(now, next_tasks);
        if (!deadline_status.ok) {
            return deadline_status.wrap_error("failed to notify about upcoming deadlines");
        }

        return Expected.ok(undefined);
    }

    private update_snapshot(tasks: TaskData[]): void {
        this.tasks = new Map(tasks.map(task => [get_task_id(task), task] as const));
    }

    private async notify_about_changes(next_tasks: TaskData[], now: Date): Promise<Status> {
        for (const task of next_tasks) {
            const known_task = this.tasks.get(get_task_id(task));
            if (!known_task) {
                const status = await this.notify_managers(
                    this.format_new_task_message(task, now),
                );
                if (!status.ok) {
                    return status.wrap_error("failed to notify managers");
                }
                continue;
            }

            if (!task_changed(known_task, task)) {
                continue;
            }

            const status = await this.notify_managers(
                this.format_task_update_message(known_task, task),
            );
            if (!status.ok) {
                return status.wrap_error("failed to notify managers");
            }
        }

        return Expected.ok(undefined);
    }

    private format_new_task_message(task: TaskData, now: Date): string {
        const lines: string[] = [
            "Создана новая задача:",
            "",
            `${this.bold("Автор:")} ${escape_html(task.author_email)}`,
            `${this.bold("Заголовок:")} ${escape_html(task.title)}`,
        ];

        if (task.deadline) {
            lines.push(
                `${this.bold("Дедлайн:")} ${escape_html(format_datetime(task.deadline))} (${days_left(task.deadline, now)} дней)`,
            );
        }
        if (task.manager) {
            lines.push(`${this.bold("Менеджер:")} ${escape_html(task.manager)}`);
        }
        if (task.assignee) {
            lines.push(`${this.bold("Исполнитель:")} ${escape_html(task.assignee)}`);
        }
        if (task.comment) {
            lines.push("", `${this.bold("Комментарий:")}`, escape_html(task.comment));
        }

        return lines.join("\n");
    }

    private format_task_update_message(previous: TaskData, next: TaskData): string {
        const changes = this.collect_changes(previous, next);
        const lines = ["Задача обновлена:", ""];

        for (const change of changes) {
            const label = `${this.bold(`${field_label(change.field)}:`)}`;
            const new_value = escape_html(change.new_value ?? "(empty)");

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

            lines.push(
                `${label} ${escape_html(change.old_value)} -&gt; ${new_value}`,
            );
        }

        return lines.join("\n");
    }

    private collect_changes(previous: TaskData, next: TaskData): ChangedField[] {
        const fields: TaskField[] = [
            "author_email",
            "status",
            "deadline",
            "manager",
            "assignee",
            "comment",
        ];

        const changes: ChangedField[] = [{
            field: "title",
            old_value: previous.title,
            new_value: next.title,
            multiline: false,
        }];

        for (const field of fields) {
            const old_value = get_field_value(previous, field);
            const new_value = get_field_value(next, field);
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

    private async maybe_send_deadline_notification(now: Date, tasks: TaskData[]): Promise<Status> {
        if (!this.config.enable_notifications) {
            return Expected.ok(undefined);
        }

        const day_key = utc_day_key(now);
        if (this.last_deadline_notification_day === day_key) {
            return Expected.ok(undefined);
        }
        if (this.last_deadline_notification_day === undefined) {
            // Do not send notification on the first day after startup
            this.last_deadline_notification_day = day_key;
            return Expected.ok(undefined);
        }

        const notification_time = this.config.notification_time_utc;
        if (now.getUTCHours() !== notification_time.hours ||
            now.getUTCMinutes() < notification_time.minutes)
        {
            return Expected.ok(undefined);
        }

        this.last_deadline_notification_day = day_key;

        const threshold_ms = this.config.deadline_threshold_days * 24 * 60 * 60 * 1000;
        const deadline_tasks = tasks
            .filter(task => is_active(task) && task.deadline != undefined)
            .filter(task => {
                const deadline_ms = task.deadline!.getTime() - now.getTime();
                return deadline_ms >= 0 && deadline_ms < threshold_ms;
            })
            .sort((left, right) => left.deadline!.getTime() - right.deadline!.getTime());

        if (deadline_tasks.length === 0) {
            return Expected.ok(undefined);
        }

        return this.notify_managers(this.format_deadline_message(deadline_tasks, now));
    }

    private format_deadline_message(tasks: TaskData[], now: Date): string {
        const lines: string[] = [
            `У ${tasks.length} задач скоро наступает дедлайн!`,
            "",
        ];

        tasks.forEach((task, idx) => {
            if (idx > 0) {
                lines.push("");
            }

            lines.push(`${this.bold("Заголовок:")} ${escape_html(task.title)}`);
            if (task.manager) {
                lines.push(`${this.bold("Менеджер:")} ${escape_html(task.manager)}`);
            }
            if (task.deadline) {
                lines.push(
                    `${this.bold("Дедлайн:")} ${escape_html(format_datetime(task.deadline))} (${days_left(task.deadline, now)} days left)`,
                );
            }
        });

        return lines.join("\n");
    }

    private async notify_managers(message: string): Promise<Status> {
        let sent = false;

        for (const adapter of this.get_adapters()) {
            const managers_chat = await adapter.get_managers_chat();
            if (!managers_chat) {
                continue;
            }

            const status = await managers_chat.send_message(message);
            if (!status.ok) {
                return status.wrap_error("managers chat notification failed");
            }
            sent = true;
        }

        if (!sent) {
            return Expected.err("managers chat is not configured");
        }

        return Expected.ok(undefined);
    }

    private bold(text: string): string {
        return `<b>${escape_html(text)}</b>`;
    }
}
