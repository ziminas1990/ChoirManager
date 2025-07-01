import { IMessagesBacklog } from "@src/interfaces/messages_backlog.js"
import { GoogleFirestore, Config as GoogleFirestoreConfig } from "./google_firestore.js";
import { Status, StatusWith } from "@src/status.js";

export type MessagesStorageConfig =
{ type: "google_firestore" } & GoogleFirestoreConfig

export class MessagesStorageFactory {
    static create(config: MessagesStorageConfig): StatusWith<IMessagesBacklog> {
        switch (config.type) {
            case "google_firestore": {
                return StatusWith.ok().with(new GoogleFirestore(config));
            }
            default: {
                return StatusWith.fail(`Unknown messages storage type: ${config.type}`);
            }
        }
    }

    static verify(config: MessagesStorageConfig): Status {
        if (!config.type) {
            return Status.fail("'type' MUST be specified");
        }
        const available_types = ["google_firestore"];
        if (!available_types.includes(config.type)) {
            return Status.fail(`'type' MUST be: ${available_types.join(", ")}`);
        }
        switch (config.type) {
            case "google_firestore": {
                if (!config.database_id) {
                    return Status.fail("'database_id' MUST be specified");
                }
                if (!config.collection_name) {
                    return Status.fail("'collection_name' MUST be specified");
                }
                return Status.ok();
            }
            default: {
                return Status.fail(`Unknown messages storage type: ${config.type}`);
            }
        }
    }
}