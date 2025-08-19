import { /*Status,*/ StatusWith } from "@src/status.js";
//import { Journal } from "@src/journal";
import { ITransactionsStorage } from "@src/interfaces/transactions_storage";
import { FirestoreTransactionsStorage } from "./google_firestore_transactions.js";

export class TransactionStorageFactory {
    static create(): StatusWith<ITransactionsStorage> {
        return StatusWith.ok().with(new FirestoreTransactionsStorage());
    }
}
