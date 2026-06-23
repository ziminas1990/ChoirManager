import { GoogleFirestoreTaskTracker, Config as GoogleFirestoreConfig } from "@src/adapters/task_tracker/google_firestore.js";
import { ITaskTracker } from "@src/interfaces/task_tracker.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";

export type TaskTrackerDatabaseConfig =
    { type: "google_firestore" } & GoogleFirestoreConfig;

export class TaskTrackerFactory {
    static create(
        config: TaskTrackerDatabaseConfig,
        parent_journal: Journal,
    ): Expected<ITaskTracker> {
        switch (config.type) {
            case "google_firestore":
                return Expected.ok(new GoogleFirestoreTaskTracker(config, parent_journal));
        }
    }

    static verify(config: TaskTrackerDatabaseConfig): Status {
        if (!config.type) {
            return Expected.err("'type' MUST be specified");
        }

        if (config.type !== "google_firestore") {
            return Expected.err("'type' MUST be: google_firestore");
        }

        if (!config.database_id) {
            return Expected.err("'database_id' MUST be specified");
        }
        if (!config.collection_name) {
            return Expected.err("'collection_name' MUST be specified");
        }

        return Expected.ok(undefined);
    }
}
