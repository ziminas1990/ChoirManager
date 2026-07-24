import { ITaskTrackerStorage } from "@src/interfaces/storage/task_tracker_storage.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";
import {
    GoogleFirestoreTaskTrackerStorage,
    Config as GoogleFirestoreConfig,
} from "./google_firestore.js";

export type TaskTrackerStorageConfig =
    { type: "google_firestore" } & GoogleFirestoreConfig;

export class TaskTrackerStorageFactory {

    static create(config: TaskTrackerStorageConfig, parent_journal: Journal)
    : Expected<ITaskTrackerStorage>
    {
        switch (config.type) {
            case "google_firestore": {
                const storage = new GoogleFirestoreTaskTrackerStorage(config, parent_journal);
                return Expected.ok(storage);
            }
        }
    }

    static verify(config: TaskTrackerStorageConfig): Status {
        if (!config.type) {
            return Expected.err("'type' MUST be specified");
        }
        const available_types = ["google_firestore"];
        if (!available_types.includes(config.type)) {
            return Expected.err(`'type' MUST be: ${available_types.join(", ")}`);
        }
        switch (config.type) {
            case "google_firestore": {
                if (!config.database_id) {
                    return Expected.err("'database_id' MUST be specified");
                }
                if (!config.collection_name) {
                    return Expected.err("'collection_name' MUST be specified");
                }
                return Expected.ok(undefined);
            }
        }
    }

}
