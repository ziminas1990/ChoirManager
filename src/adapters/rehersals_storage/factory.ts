import { IRehersalsStorage } from "@src/interfaces/rehersals_storage.js";
import { GoogleSpreadsheetRehersalsStorage, Config as GoogleSpreadsheetConfig } from "./google_spreadsheet.js";
import { Status, StatusWith } from "@src/status.js";

export type RehersalsStorageConfig =
{ type: "google_spreadsheet" } & GoogleSpreadsheetConfig;

export class RehersalsStorageFactory {

    static create(config: RehersalsStorageConfig)
    : StatusWith<IRehersalsStorage>
    {
        switch (config.type) {
            case "google_spreadsheet": {
                const storage = new GoogleSpreadsheetRehersalsStorage(config);
                return Status.ok().with(storage);
            }
        }
    }

    static verify(config: RehersalsStorageConfig): Status {
        if (!config.type) {
            return Status.fail("'type' MUST be specified");
        }
        const available_types = ["local_json_file", "google_spreadsheet"];
        if (!available_types.includes(config.type)) {
            return Status.fail(`'type' MUST be: ${available_types.join(", ")}`);
        }
        switch (config.type) {
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