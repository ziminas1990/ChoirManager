import { Expected, Status } from "@src/utils/expected.js";
import { ITransactionsStorage } from "@src/interfaces/transactions_storage.js";
import { FirestoreTransactionsStorage } from "./google_firestore_transactions.js";


export type TransactionStorageConfig = {
    type: "google_firestore";
    read_only: boolean;
    database_id: string;
    collection_name: string;
};

export class TransactionStorageFactory {
    static create(config: TransactionStorageConfig)
    : Expected<ITransactionsStorage> {
        switch (config.type) {
            case "google_firestore":
                return Expected.ok(new FirestoreTransactionsStorage(config));
        }
    }

    static verify(config: TransactionStorageConfig): Status {
        if (!config.type) {
            return Expected.err("'type' MUST be specified");
        }
        const available_types = ["google_firestore"];
        if (!available_types.includes(config.type)) {
            return Expected.err(`'type' MUST be: ${available_types.join(", ")}`);
        }
        switch (config.type) {
            case "google_firestore": {
                if (typeof config.read_only !== "boolean") {
                    return Expected.err("'read_only' MUST be specified");
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
    }
}
