import {
    GoogleFirestoreSimpleMemoryStorage,
    Config as GoogleFirestoreConfig,
} from "@src/adapters/simple_memory/google_firestore.js";
import { ISimpleMemoryStorage } from "@src/interfaces/simple_memory.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";

export type SimpleMemoryDatabaseConfig =
    { type: "google_firestore" } & GoogleFirestoreConfig;

export class SimpleMemoryFactory {
    static create(
        config: SimpleMemoryDatabaseConfig,
        parent_journal: Journal,
    ): Expected<ISimpleMemoryStorage> {
        switch (config.type) {
            case "google_firestore":
                return Expected.ok(new GoogleFirestoreSimpleMemoryStorage(config, parent_journal));
        }
    }

    static verify(config: SimpleMemoryDatabaseConfig): Status {
        if (!config.type) {
            return Expected.err("'type' MUST be specified");
        }

        if (config.type !== "google_firestore") {
            return Expected.err("'type' MUST be: google_firestore");
        }

        if (!config.database_id) {
            return Expected.err("'database_id' MUST be specified");
        }
        if (!config.collection_name) {
            return Expected.err("'collection_name' MUST be specified");
        }

        return Expected.ok(undefined);
    }
}
