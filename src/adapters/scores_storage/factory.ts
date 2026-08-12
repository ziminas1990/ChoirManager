import { IScoresStorage } from "@src/interfaces/storage/scores_storage.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";
import {
    GoogleSpreadsheetScoresStorage,
    Config as GoogleSpreadsheetConfig,
} from "./google_spreadsheet.js";

export type ScoresStorageConfig =
    { type: "google_spreadsheet" } & GoogleSpreadsheetConfig;

export class ScoresStorageFactory {

    static create(config: ScoresStorageConfig, parent_journal: Journal)
    : Expected<IScoresStorage>
    {
        switch (config.type) {
            case "google_spreadsheet": {
                const storage = new GoogleSpreadsheetScoresStorage(config, parent_journal);
                return Expected.ok(storage);
            }
            default: {
                return Expected.err(`Unsupported scores storage type: ${config.type}`);
            }
        }
    }

    static verify(config: ScoresStorageConfig): Status {
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
            default: {
                return Expected.err(`Unsupported scores storage type: ${config.type}`);
            }
        }
    }

}
