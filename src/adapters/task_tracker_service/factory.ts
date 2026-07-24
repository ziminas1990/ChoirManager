import {
    TaskTrackerStorageConfig,
    TaskTrackerStorageFactory,
} from "@src/adapters/task_tracker_storage/factory.js";
import { TaskTrackerService } from "@src/components/task_tracker_service.js";
import { IBroadcaster } from "@src/interfaces/message_queue.js";
import { TaskTrackerEvent } from "@src/interfaces/task_tracker_service.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";

// "local" — TaskTrackerService is instantiated in-process on top of ITaskTrackerStorage.
export type TaskTrackerServiceConfigJson = {
    type: "local";
    storage: TaskTrackerStorageConfig;
    enable_notifications: boolean;
    notification_time_utc: string;
    // Days before deadline when notifications are sent.
    deadline_notification_days: number[];
}

export class TaskTrackerServiceConfig {
    constructor(private readonly json: TaskTrackerServiceConfigJson) {}

    get type(): "local" {
        return this.json.type;
    }

    get storage(): TaskTrackerStorageConfig {
        return this.json.storage;
    }

    get enable_notifications(): boolean {
        return this.json.enable_notifications;
    }

    get notification_time_utc(): { hours: number; minutes: number } {
        const [hours, minutes] = this.json.notification_time_utc.split(":").map(part => parseInt(part, 10));
        return { hours, minutes };
    }

    get deadline_notification_days(): number[] {
        return this.json.deadline_notification_days;
    }

    verify(): Status {
        if (!this.json.type) {
            return Expected.err("'type' MUST be specified");
        }
        if (this.json.type !== "local") {
            return Expected.err("'type' MUST be: local");
        }
        if (!this.json.storage) {
            return Expected.err("'storage' MUST be specified");
        }
        const storage_status = TaskTrackerStorageFactory.verify(this.json.storage);
        if (!storage_status.ok) {
            return storage_status.wrap_error("'storage' misconfiguration");
        }

        if (typeof this.json.enable_notifications !== "boolean") {
            return Expected.err("'enable_notifications' MUST be specified");
        }

        if (!this.json.notification_time_utc) {
            return Expected.err("'notification_time_utc' MUST be specified");
        }
        if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(this.json.notification_time_utc)) {
            return Expected.err("'notification_time_utc' MUST be in HH:MM format");
        }

        if (!Array.isArray(this.json.deadline_notification_days)) {
            return Expected.err("'deadline_notification_days' MUST be specified");
        }
        if (this.json.deadline_notification_days.length === 0) {
            return Expected.err("'deadline_notification_days' MUST not be empty");
        }
        for (const day of this.json.deadline_notification_days) {
            if (!Number.isInteger(day) || day < 0) {
                return Expected.err("'deadline_notification_days' MUST contain only non-negative integers");
            }
        }

        return Expected.ok(undefined);
    }
}

export class TaskTrackerServiceFactory {
    static create(
        config: TaskTrackerServiceConfig,
        broadcaster: IBroadcaster<TaskTrackerEvent>,
        parent_journal: Journal,
    ): Expected<TaskTrackerService> {
        switch (config.type) {
            case "local": {
                const storage_status = TaskTrackerStorageFactory.create(
                    config.storage,
                    parent_journal,
                );
                if (!storage_status.ok) {
                    return storage_status.wrap_error("can't create task tracker storage");
                }
                return Expected.ok(new TaskTrackerService(
                    config.enable_notifications,
                    config.notification_time_utc,
                    config.deadline_notification_days,
                    storage_status.value,
                    broadcaster,
                    parent_journal,
                ));
            }
        }
    }
}
