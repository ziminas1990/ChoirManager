import { IKeyValueStorage } from "@src/interfaces/storage/key_value_storage.js";
import { Expected, Status } from "@src/utils/expected.js";
import { Config, GoogleFirestoreKeyValueStorage } from "./google_firestore.js";

export type KeyValueStorageConfig = { type: "google_firestore" } & Config;

export class KeyValueStorageFactory {
    static create(config: KeyValueStorageConfig): Expected<IKeyValueStorage> {
        const verified = this.verify(config);
        if (!verified.ok) {
            return verified.cast_error();
        }
        try {
            return Expected.ok(new GoogleFirestoreKeyValueStorage(config));
        } catch (error) {
            return Expected.exception("Failed to create key-value storage", error);
        }
    }

    static verify(config: KeyValueStorageConfig): Status {
        if (!config || config.type !== "google_firestore") {
            return Expected.err("'type' MUST be: google_firestore");
        }
        if (typeof config.database_id !== "string" || !config.database_id.trim()) {
            return Expected.err("'database_id' MUST be specified");
        }
        if (typeof config.collection_name !== "string" || !config.collection_name.trim()) {
            return Expected.err("'collection_name' MUST be specified");
        }
        return Expected.ok(undefined);
    }
}
