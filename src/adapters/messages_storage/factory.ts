import { IMessagesBacklog } from "@src/interfaces/messages_backlog.js"
import { GoogleFirestore, Config as GoogleFirestoreConfig } from "./google_firestore.js";
import { Expected, Status } from "@src/utils/expected.js";

export type MessagesStorageConfig =
{ type: "google_firestore", read_only: boolean } & GoogleFirestoreConfig

export class MessagesStorageFactory {
    static create(config: MessagesStorageConfig): Expected<IMessagesBacklog> {
        switch (config.type) {
            case "google_firestore": {
                return Expected.ok(new GoogleFirestore(config, config.read_only));
            }
            default: {
                return Expected.err(`Unknown messages storage type: ${config.type}`);
            }
        }
    }

    static verify(config: MessagesStorageConfig): Status {
        if (!config.type) {
            return Expected.err("'type' MUST be specified");
        }
        if (config.read_only === undefined) {
            return Expected.err("'read_only' MUST be specified");
        }
        const available_types = ["google_firestore"];
        if (!available_types.includes(config.type)) {
            return Expected.err(`'type' MUST be: ${available_types.join(", ")}`);
        }
        switch (config.type) {
            case "google_firestore": {
                if (!config.database_id) {
                    return Expected.err("'database_id' MUST be specified");
                }
                if (!config.collection_name) {
                    return Expected.err("'collection_name' MUST be specified");
                }
                return Expected.ok(undefined);
            }
            default: {
                return Expected.err(`Unknown messages storage type: ${config.type}`);
            }
        }
    }
}