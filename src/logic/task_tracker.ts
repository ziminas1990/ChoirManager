import { TaskTrackerConfig } from "@src/config.js";
import {
    NewTaskData,
    TaskData,
    TaskFilter,
    TaskUpdate,
    filter_tasks,
    get_task_id,
} from "@src/entities/task.js";
import { IBroadcaster } from "@src/interfaces/message_queue.js";
import { ITaskTracker } from "@src/interfaces/task_tracker.js";
import { Journal } from "@src/journal.js";
import { Logic } from "@src/logic/abstracts.js";
import { Expected, Status } from "@src/utils/expected.js";


function pad_2(value: number): string {
    return value.toString().padStart(2, "0");
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

const DEADLINE_NOTIFICATION_DAYS = [7, 3, 1] as const;

function days_until_deadline(deadline: Date, now: Date): number {
    return Math.ceil((deadline.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

function is_deadline_notification_day(deadline: Date, now: Date): boolean {
    const days = days_until_deadline(deadline, now);
    return days >= 0 && (DEADLINE_NOTIFICATION_DAYS as readonly number[]).includes(days);
}

export type TaskTrackerEvent = {
    what: "new_task",
    task: TaskData,
} | {
    what: "task_updated",
    update: TaskUpdate[],
} | {
    what: "task_deleted",
    task: TaskData,
} | {
    what: "deadline_notification",
    tasks: TaskData[],
}

export class TaskTracker extends Logic<void> {
    private readonly journal: Journal;

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

    async create_task(task: NewTaskData): Promise<Expected<TaskData>> {
        const created_status = await this.adapter.create(task);
        if (!created_status.ok) {
            return created_status.wrap_error("failed to create task");
        }

        const created = created_status.value;
        this.tasks.set(get_task_id(created), created);

        const broadcast_status = await this.broadcast_event({
            what: "new_task",
            task: created,
        });
        if (!broadcast_status.ok) {
            return broadcast_status.cast_error<TaskData>().wrap_error("failed to broadcast new task event");
        }

        return Expected.ok(created);
    }

    async update_task(task: TaskData): Promise<Expected<TaskUpdate>> {
        if (!this.tasks.has(get_task_id(task))) {
            return Expected.err("task not found in local snapshot");
        }

        const update_status = await this.adapter.update(task);
        if (!update_status.ok) {
            return update_status.wrap_error("failed to update task");
        }

        this.tasks.set(get_task_id(update_status.value.next), update_status.value.next);

        if (Object.keys(update_status.value.updates).length > 0) {
            const broadcast_status = await this.broadcast_event({
                what: "task_updated",
                update: [update_status.value],
            });
            if (!broadcast_status.ok) {
                return broadcast_status.cast_error<TaskUpdate>().wrap_error("failed to broadcast task update event");
            }
        }

        return update_status;
    }

    async delete_task(task: TaskData): Promise<Expected<TaskData>> {
        if (!this.tasks.has(get_task_id(task))) {
            return Expected.err("task not found in local snapshot");
        }

        const deleted_status = await this.adapter.delete(task);
        if (!deleted_status.ok) {
            return deleted_status.wrap_error("failed to delete task");
        }

        this.tasks.delete(get_task_id(task));

        const broadcast_status = await this.broadcast_event({
            what: "task_deleted",
            task: deleted_status.value,
        });
        if (!broadcast_status.ok) {
            return broadcast_status.cast_error<TaskData>().wrap_error("failed to broadcast task deletion event");
        }

        return deleted_status;
    }

    async init(now: Date = new Date()): Promise<Status> {
        const tasks_status = await this.adapter.fetch();
        if (!tasks_status.ok) {
            return tasks_status.wrap_error("failed to fetch tasks");
        }

        this.update_snapshot(tasks_status.value);

        const deadline_status = await this.maybe_send_deadline_notification(now, tasks_status.value);
        if (!deadline_status.ok) {
            this.journal.log().warn(`Failed to send deadline notifications: ${deadline_status.error}`);
        }

        return Expected.ok(undefined);
    }

    protected async proceed_impl(now: Date, _interval_ms: number): Promise<Expected<void[]>> {
        const deadline_status = await this.maybe_send_deadline_notification(now, this.get_tasks());
        if (!deadline_status.ok) {
            this.journal.log().warn(`Failed to send deadline notifications: ${deadline_status.error}`);
        }
        return Expected.ok([]);
    }

    private update_snapshot(tasks: TaskData[]): void {
        this.tasks = new Map(tasks.map(task => [get_task_id(task), task] as const));
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

        const deadline_tasks = tasks
            .filter(task => is_active(task) && task.deadline != undefined)
            .filter(task => is_deadline_notification_day(task.deadline!, now))
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
