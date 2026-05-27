import { IRehersalsStorage } from "@src/interfaces/rehersals_storage.js";
import { GoogleSpreadsheetRehersalsStorage, Config as GoogleSpreadsheetConfig } from "./google_spreadsheet.js";
import { Expected, Status } from "@src/utils/expected.js";

export type RehersalsStorageConfig =
{ type: "google_spreadsheet" } & GoogleSpreadsheetConfig;

export class RehersalsStorageFactory {

    static create(config: RehersalsStorageConfig)
    : Expected<IRehersalsStorage>
    {
        switch (config.type) {
            case "google_spreadsheet": {
                const storage = new GoogleSpreadsheetRehersalsStorage(config);
                return Expected.ok(storage);
            }
        }
    }

    static verify(config: RehersalsStorageConfig): Status {
        if (!config.type) {
            return Expected.err("'type' MUST be specified");
        }
        const available_types = ["local_json_file", "google_spreadsheet"];
        if (!available_types.includes(config.type)) {
            return Expected.err(`'type' MUST be: ${available_types.join(", ")}`);
        }
        switch (config.type) {
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