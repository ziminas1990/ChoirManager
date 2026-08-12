import fs from "fs";

import {
    ScoresStorageConfig,
    ScoresStorageFactory,
} from "@src/adapters/scores_storage/factory.js";
import { ScoresService } from "@src/components/scores_service.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";

// "local" — ScoresService is instantiated in-process on top of IScoresStorage.
export type ScoresServiceConfigJson = {
    type: "local";
    storage: ScoresStorageConfig;
    fetch_interval_sec: number;
    model: string;
    search_prompt_file: string;
}

export class ScoresServiceConfig {
    constructor(private readonly json: ScoresServiceConfigJson) {}

    get type(): "local" {
        return this.json.type;
    }

    get storage(): ScoresStorageConfig {
        return this.json.storage;
    }

    get fetch_interval_sec(): number {
        return this.json.fetch_interval_sec;
    }

    get model(): string {
        return this.json.model;
    }

    get search_prompt_file(): string {
        return this.json.search_prompt_file;
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
        const storage_status = ScoresStorageFactory.verify(this.json.storage);
        if (!storage_status.ok) {
            return storage_status.wrap_error("'storage' misconfiguration");
        }

        if (!this.json.fetch_interval_sec) {
            return Expected.err("'fetch_interval_sec' MUST be specified");
        }
        if (this.json.fetch_interval_sec < 60) {
            return Expected.err("'fetch_interval_sec' MUST be at least 60 seconds");
        }

        if (!this.json.model) {
            return Expected.err("'model' MUST be specified");
        }
        if (!this.json.search_prompt_file) {
            return Expected.err("'search_prompt_file' MUST be specified");
        }
        if (!fs.existsSync(this.search_prompt_file)) {
            return Expected.err(
                `'search_prompt_file' does not exist: ${this.search_prompt_file}`,
            );
        }

        return Expected.ok(undefined);
    }
}

export class ScoresServiceFactory {
    static create(
        config: ScoresServiceConfig,
        parent_journal: Journal,
    ): Expected<ScoresService> {
        switch (config.type) {
            case "local": {
                const storage_status = ScoresStorageFactory.create(
                    config.storage,
                    parent_journal,
                );
                if (!storage_status.ok) {
                    return storage_status.wrap_error("can't create scores storage");
                }
                return Expected.ok(new ScoresService(
                    config.model,
                    config.search_prompt_file,
                    storage_status.value,
                    config.fetch_interval_sec,
                    parent_journal,
                ));
            }
            default: {
                return Expected.err(`Unsupported scores service type: ${config.type}`);
            }
        }
    }
}
