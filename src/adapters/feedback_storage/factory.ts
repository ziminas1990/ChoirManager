import { LocalJsonFileFeedbackStorage, Config as LocalJsonFileConfig } from "./local_json_file.js";
import { GoogleSpreadsheetFeedbackStorage, Config as GoogleSpreadsheetConfig } from "./google_spreadsheet.js";
import { IFeedbackStorage } from "@src/interfaces/feedback_storage.js";
import { Status, StatusWith } from "@src/status.js";

export type FeedbackStorageConfig =
{ type: "local_json_file" } & LocalJsonFileConfig |
{ type: "google_spreadsheet" } & GoogleSpreadsheetConfig

export class FeedbackStorageFactory {

    static create(config: FeedbackStorageConfig): StatusWith<IFeedbackStorage> {
        switch (config.type) {
            case "local_json_file": {
                return Status.ok().with(new LocalJsonFileFeedbackStorage(config));
            }
            case "google_spreadsheet": {
                const storage = new GoogleSpreadsheetFeedbackStorage(config);
                return Status.ok().with(storage);
            }
        }
    }

    static verify(config: FeedbackStorageConfig): Status {
        if (!config.type) {
            return Status.fail("'type' MUST be specified");
        }
        const available_types = ["local_json_file", "google_spreadsheet"];
        if (!available_types.includes(config.type)) {
            return Status.fail(`'type' MUST be: ${available_types.join(", ")}`);
        }
        switch (config.type) {
            case "local_json_file": {
                if (!config.filename) {
                    return Status.fail("'filename' MUST be specified");
                }
                return Status.ok();
            }
            case "google_spreadsheet": {
                if (!config.spreadsheet_id) {
                    return Status.fail("'spreadsheet_id' MUST be specified");
                }
                if (!config.sheet_name) {
                    return Status.fail("'sheet_name' MUST be specified");
                }
                return Status.ok();
            }
        }
    }

}