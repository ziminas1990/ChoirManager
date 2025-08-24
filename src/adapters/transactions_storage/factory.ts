import { Status, StatusWith } from "@src/status.js";
import { ITransactionsStorage } from "@src/interfaces/transactions_storage";
import { FirestoreTransactionsStorage } from "./google_firestore_transactions.js";


export type TransactionStorageConfig = {
    type: "google_firestore";
    read_only: boolean;
    database_id: string;
    collection_name: string;
};

export class TransactionStorageFactory {
    static create(config: TransactionStorageConfig)
    : StatusWith<ITransactionsStorage> {
        switch (config.type) {
            case "google_firestore":
                return Status.ok().with(new FirestoreTransactionsStorage(config));
        }
    }
}
