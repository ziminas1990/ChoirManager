import { TaskTrackerConfig } from "@src/config.js";
import { TaskData, TaskFilter, TaskStatus, filter_tasks } from "@src/entities/task.js";
import { IBroadcaster } from "@src/interfaces/message_queue.js";
import { ITaskTracker } from "@src/interfaces/task_tracker.js";
import { Journal } from "@src/journal.js";
import { Logic } from "@src/logic/abstracts.js";
import { Expected, Status } from "@src/utils/expected.js";


type TaskField = Exclude<keyof TaskData, "created_at">;

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

export type TaskUpdate = {
    task_id: string,
    previous: TaskData,
    next: TaskData,
    updates: Partial<{
        [Field in TaskField]: {
        previous?: TaskData[Field],
        next?: TaskData[Field],
        };
    }>;
};

export type TaskTrackerEvent = {
    what: "new_task",
    task: TaskData,
} | {
    what: "task_updated",
    update: TaskUpdate[],
} | {
    what: "deadline_notification",
    tasks: TaskData[],
}

export class TaskTracker extends Logic<void> {
    private readonly journal: Journal;

    private fetch_promise?: Promise<void>;
    private initialized = false;
    private tasks: Map<string, TaskData> = new Map();
    private last_deadline_notification_day?: string;

    constructor(
        private readonly config: TaskTrackerConfig,
        private readonly adapter: ITaskTracker,
        private readonly broadcaster: IBroadcaster<TaskTrackerEvent>,
        parent_journal: Journal,
    ) {
        super(5000);
        this.journal = parent_journal.child("task_tracker_logic");
    }

    get_tasks(filter?: TaskFilter): TaskData[] {
        return filter_tasks(Array.from(this.tasks.values()), filter);
    }

    async init(now: Date = new Date()): Promise<Status> {
        const tasks_status = await this.adapter.fetch();
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
        const tasks_status = await this.adapter.fetch();
        if (!tasks_status.ok) {
            return tasks_status.wrap_error("failed to fetch tasks");
        }

        const next_tasks = tasks_status.value;
        if (this.initialized) {
            const notify_status = await this.notify_about_changes(next_tasks);
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

    private async notify_about_changes(next_tasks: TaskData[]): Promise<Status> {
        for (const task of next_tasks) {
            const known_task = this.tasks.get(get_task_id(task));
            if (!known_task) {
                const status = await this.broadcast_event({
                    what: "new_task",
                    task,
                });
                if (!status.ok) {
                    return status.wrap_error("failed to broadcast new task event");
                }
                continue;
            }

            if (!task_changed(known_task, task)) {
                continue;
            }

            const status = await this.broadcast_event({
                what: "task_updated",
                update: [this.create_task_update(known_task, task)],
            });
            if (!status.ok) {
                return status.wrap_error("failed to broadcast task update event");
            }
        }

        return Expected.ok(undefined);
    }

    private create_task_update(previous: TaskData, next: TaskData): TaskUpdate {
        const update: TaskUpdate = {
            task_id: get_task_id(next),
            previous,
            next,
            updates: {},
        };

        if (previous.author_email !== next.author_email) {
            update.updates.author_email = { previous: previous.author_email, next: next.author_email };
        }
        if (previous.title !== next.title) {
            update.updates.title = { previous: previous.title, next: next.title };
        }
        if (previous.comment !== next.comment) {
            update.updates.comment = { previous: previous.comment, next: next.comment };
        }
        if (previous.status !== next.status) {
            update.updates.status = { previous: previous.status, next: next.status };
        }
        if (previous.deadline?.getTime() !== next.deadline?.getTime()) {
            update.updates.deadline = { previous: previous.deadline, next: next.deadline };
        }
        if (previous.manager !== next.manager) {
            update.updates.manager = { previous: previous.manager, next: next.manager };
        }
        if (previous.assignee !== next.assignee) {
            update.updates.assignee = { previous: previous.assignee, next: next.assignee };
        }

        return update;
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

        return this.broadcast_event({
            what: "deadline_notification",
            tasks: deadline_tasks,
        });
    }

    private async broadcast_event(event: TaskTrackerEvent): Promise<Status> {
        return await this.broadcaster.broadcast(event);
    }

}
