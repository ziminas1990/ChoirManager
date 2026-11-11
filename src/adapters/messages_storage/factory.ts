import { IMessagesBacklog } from "@src/interfaces/messages_backlog.js";
import { IJournal } from "@src/interfaces/journal.js";
import { MessagesBacklogCache } from "@src/components/messages_backlog_cache.js";
import { GoogleFirestore, Config as GoogleFirestoreConfig } from "./google_firestore.js";
import { Expected, Status } from "@src/utils/expected.js";

export type MessagesStorageConfig =
    | ({ type: "firestore" | "google_firestore"; read_only: boolean } & GoogleFirestoreConfig)
    | { type: "local_cache"; window_days: number; underlying: MessagesStorageConfig };

export class MessagesStorageFactory {
    static create(config: MessagesStorageConfig, journal: IJournal): Expected<IMessagesBacklog> {
        const status = this.verify(config);
        if (!status.ok) {
            return status.cast_error();
        }
        const type = config.type;
        switch (config.type) {
            case "local_cache": {
                const underlying = this.create(config.underlying, journal);
                if (!underlying.ok) {
                    return underlying.wrap_error("failed to create underlying backlog");
                }
                return Expected.ok(new MessagesBacklogCache(
                    underlying.value, config.window_days, journal.child("messages_backlog_cache")));
            }
            case "firestore":
            case "google_firestore": {
                return Expected.ok(new GoogleFirestore(config, config.read_only));
            }
            default: {
                return Expected.err(`Unknown messages storage type: ${type}`);
            }
        }
    }

    static verify(config: MessagesStorageConfig): Status {
        if (!config || !config.type) {
            return Expected.err("'type' MUST be specified");
        }
        const type = config.type;
        switch (config.type) {
            case "local_cache": {
                if (!Number.isInteger(config.window_days) || config.window_days <= 0) {
                    return Expected.err("'window_days' MUST be a positive integer");
                }
                if (!config.underlying) {
                    return Expected.err("'underlying' MUST be specified");
                }
                const status = this.verify(config.underlying);
                return status.ok ? status : status.wrap_error("underlying backlog misconfiguration");
            }
            case "firestore":
            case "google_firestore": {
                if (typeof config.read_only !== "boolean") {
                    return Expected.err("'read_only' MUST be a boolean");
                }
                if (!config.database_id) {
                    return Expected.err("'database_id' MUST be specified");
                }
                if (!config.collection_name) {
                    return Expected.err("'collection_name' MUST be specified");
                }
                return Expected.ok(undefined);
            }
            default: {
                return Expected.err(`Unknown messages storage type: ${type}`);
            }
        }
    }
}
