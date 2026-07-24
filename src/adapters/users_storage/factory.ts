import { IUsersStorage } from "@src/interfaces/storage/users_storage.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";
import { GoogleSpreadsheetUsersStorage, Config as GoogleSpreadsheetConfig } from "./google_spreadsheet.js";

export type UsersStorageConfig =
{ type: "google_spreadsheet" } & GoogleSpreadsheetConfig;

export class UsersStorageFactory {

    static create(config: UsersStorageConfig, parent_journal: Journal)
    : Expected<IUsersStorage>
    {
        switch (config.type) {
            case "google_spreadsheet": {
                const storage = new GoogleSpreadsheetUsersStorage(config, parent_journal);
                return Expected.ok(storage);
            }
        }
    }

    static verify(config: UsersStorageConfig): Status {
        if (!config.type) {
            return Expected.err("'type' MUST be specified");
        }
        const available_types = ["google_spreadsheet"];
        if (!available_types.includes(config.type)) {
            return Expected.err(`'type' MUST be: ${available_types.join(", ")}`);
        }
        switch (config.type) {
            case "google_spreadsheet": {
                if (!config.google_sheet_id) {
                    return Expected.err("'google_sheet_id' MUST be specified");
                }
                if (!config.range) {
                    return Expected.err("'range' MUST be specified");
                }
                return Expected.ok(undefined);
            }
        }
    }

}
