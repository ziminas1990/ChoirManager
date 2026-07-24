import fs from "fs";

import {
    SimpleMemoryStorageConfig,
    SimpleMemoryStorageFactory,
} from "@src/adapters/simple_memory_storage/factory.js";
import { SimpleMemoryService } from "@src/components/simple_memory_service.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";

// "local" — SimpleMemoryService is instantiated in-process on top of ISimpleMemoryStorage.
export type SimpleMemoryServiceConfigJson = {
    type: "local";
    storage: SimpleMemoryStorageConfig;
    model: string;
    search_prompt_file: string;
    ask_prompt_file: string;
}

export class SimpleMemoryServiceConfig {
    constructor(private readonly json: SimpleMemoryServiceConfigJson) {}

    get type(): "local" {
        return this.json.type;
    }

    get storage(): SimpleMemoryStorageConfig {
        return this.json.storage;
    }

    get model(): string {
        return this.json.model;
    }

    get search_prompt_file(): string {
        return this.json.search_prompt_file;
    }

    get ask_prompt_file(): string {
        return this.json.ask_prompt_file;
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
        const storage_status = SimpleMemoryStorageFactory.verify(this.json.storage);
        if (!storage_status.ok) {
            return storage_status.wrap_error("'storage' misconfiguration");
        }
        if (!this.json.model) {
            return Expected.err("'model' MUST be specified");
        }
        if (!this.json.search_prompt_file) {
            return Expected.err("'search_prompt_file' MUST be specified");
        }
        if (!fs.existsSync(this.search_prompt_file)) {
            return Expected.err(`'search_prompt_file' does not exist: ${this.search_prompt_file}`);
        }
        if (!this.json.ask_prompt_file) {
            return Expected.err("'ask_prompt_file' MUST be specified");
        }
        if (!fs.existsSync(this.ask_prompt_file)) {
            return Expected.err(`'ask_prompt_file' does not exist: ${this.ask_prompt_file}`);
        }
        return Expected.ok(undefined);
    }
}

export class SimpleMemoryServiceFactory {
    static create(
        config: SimpleMemoryServiceConfig,
        parent_journal: Journal,
    ): Expected<SimpleMemoryService> {
        switch (config.type) {
            case "local": {
                const storage_status = SimpleMemoryStorageFactory.create(
                    config.storage,
                    parent_journal,
                );
                if (!storage_status.ok) {
                    return storage_status.wrap_error("can't create simple memory storage");
                }
                return Expected.ok(new SimpleMemoryService(
                    config.model,
                    config.search_prompt_file,
                    config.ask_prompt_file,
                    storage_status.value,
                    parent_journal,
                ));
            }
        }
    }
}
