import { GoogleSheetTaskTracker, Config as GoogleSpreadsheetConfig } from "@src/adapters/task_tracker/google_spreadsheet.js";
import { ITaskTracker } from "@src/interfaces/task_tracker.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";

export type TaskTrackerDatabaseConfig =
    { type: "google_spreadsheet" } & GoogleSpreadsheetConfig;

export class TaskTrackerFactory {
    static create(
        config: TaskTrackerDatabaseConfig,
        parent_journal: Journal,
    ): Expected<ITaskTracker> {
        switch (config.type) {
            case "google_spreadsheet":
                return Expected.ok(new GoogleSheetTaskTracker(config, parent_journal));
        }
    }

    static verify(config: TaskTrackerDatabaseConfig): Status {
        if (!config.type) {
            return Expected.err("'type' MUST be specified");
        }

        if (config.type !== "google_spreadsheet") {
            return Expected.err("'type' MUST be: google_spreadsheet");
        }

        if (!config.spreadsheet_id) {
            return Expected.err("'spreadsheet_id' MUST be specified");
        }
        if (!config.sheet_name) {
            return Expected.err("'sheet_name' MUST be specified");
        }
        if (!config.fetch_interval_sec) {
            return Expected.err("'fetch_interval_sec' MUST be specified");
        }
        if (config.fetch_interval_sec < 10) {
            return Expected.err("'fetch_interval_sec' MUST be at least 10 seconds");
        }

        return Expected.ok(undefined);
    }
}
