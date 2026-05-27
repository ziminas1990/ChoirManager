import { LocalJsonFileFeedbackStorage, Config as LocalJsonFileConfig } from "./local_json_file.js";
import { GoogleSpreadsheetFeedbackStorage, Config as GoogleSpreadsheetConfig } from "./google_spreadsheet.js";
import { IFeedbackStorage } from "@src/interfaces/feedback_storage.js";
import { Expected, Status } from "@src/utils/expected.js";
import { Journal } from "@src/journal.js";

export type FeedbackStorageConfig =
{ type: "local_json_file" } & LocalJsonFileConfig |
{ type: "google_spreadsheet" } & GoogleSpreadsheetConfig

export class FeedbackStorageFactory {

    static create(config: FeedbackStorageConfig, parent_journal: Journal)
    : Expected<IFeedbackStorage>
    {
        switch (config.type) {
            case "local_json_file": {
                return Expected.ok(new LocalJsonFileFeedbackStorage(config));
            }
            case "google_spreadsheet": {
                const storage = new GoogleSpreadsheetFeedbackStorage(config, parent_journal);
                return Expected.ok(storage);
            }
        }
    }

    static verify(config: FeedbackStorageConfig): Status {
        if (!config.type) {
            return Expected.err("'type' MUST be specified");
        }
        const available_types = ["local_json_file", "google_spreadsheet"];
        if (!available_types.includes(config.type)) {
            return Expected.err(`'type' MUST be: ${available_types.join(", ")}`);
        }
        switch (config.type) {
            case "local_json_file": {
                if (!config.filename) {
                    return Expected.err("'filename' MUST be specified");
                }
                return Expected.ok(undefined);
            }
            case "google_spreadsheet": {
                if (!config.spreadsheet_id) {
                    return Expected.err("'spreadsheet_id' MUST be specified");
                }
                if (!config.sheet_name) {
                    return Expected.err("'sheet_name' MUST be specified");
                }
                return Expected.ok(undefined);
            }
        }
    }

}