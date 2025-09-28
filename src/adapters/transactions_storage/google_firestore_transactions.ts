import { Transaction } from "@src/interfaces/transactions_storage.js";
import { ITransactionsStorage } from "@src/interfaces/transactions_storage.js";
import { GoogleAuth } from "@src/api/google_auth.js";
import {  Firestore,  CollectionReference, } from "@google-cloud/firestore";
import { TransactionStorageConfig } from "./factory.js";


export class FirestoreTransactionsStorage implements ITransactionsStorage {
    private db: Firestore;
    private readonly collection: CollectionReference;

    constructor(private config: TransactionStorageConfig) {
        this.db = GoogleAuth.get_firestore(this.config.database_id);
        this.collection = this.db.collection(this.config.collection_name) as CollectionReference;
    }

    public async add_transaction(e: Transaction) {
        if (this.config.read_only){ // todo: implement read-only mode / log
            return;
        }
        e.tgid = e.tgid.trim().toLowerCase();
        await this.collection.add(e);
    }

    public async fetch_transactions(
    tgid: string,
    opts: { limit?: number; order?: "asc" | "desc" } = {}
    ): Promise<Transaction[]> {
        const order = opts.order ?? "desc";

        let query = this.collection.where("tgid", "==", tgid.trim().toLowerCase())
            .orderBy("date", order);
        if (opts.limit) {
            query = query.limit(opts.limit);
        }

        const response = await query.get();
        const result: Transaction[] = [];        
        
        response.forEach((doc) => {
            result.push({
                date: new Date(doc.data().date._seconds * 1000),
                tgid: doc.data().tgid,
                type: doc.data().type,
                before: doc.data().before,
                after: doc.data().after,
                membership_month: doc.data().membership_month 
                    ? new Date(doc.data().membership_month._seconds * 1000) 
                    : undefined
            });
        });

        return result;
    }
}

