import { Transaction } from "@src/interfaces/transactions_storage.js";
import { ITransactionsStorage } from "@src/interfaces/transactions_storage.js";
import { GoogleAuth } from "@src/api/google_auth.js";
import {  Firestore,  CollectionReference, } from "@google-cloud/firestore";


export class FirestoreTransactionsStorage implements ITransactionsStorage {
    private db: Firestore;
    private readonly col: CollectionReference<Transaction>;

    constructor() {
        this.db = GoogleAuth.get_firestore("(default)");
        this.col = this.db.collection("transactions") as CollectionReference<Transaction>;
    }

    public async save_balance_change(e: Transaction) {
        e.tgid = e.tgid.trim().toLowerCase();
        await this.col.add(e);
    }

    public async fetch_transactions(
    tgid: string,
    opts: { limit?: number; order?: "asc" | "desc" } = {}
    ): Promise<Transaction[]> {
        const order = opts.order ?? "desc";

        let query = this.col.where("tgid", "==", tgid.trim().toLowerCase())
            .orderBy("date", order);
        if (opts.limit) query = query.limit(opts.limit);

        const response = await query.get();
        return response.docs.map(d => {
            const x: any = d.data();
            const v = x.date;
            x.date = v && typeof v.toDate === "function" ? v.toDate() : new Date(v);
            return x as Transaction;
        });
    }

    // currently is not working
    async getByTgid2(
        tgid: string,
        opts: {
            limit?: number;
            order?: "asc" | "desc";
        from?: Date;               
        to?: Date;                 
        startAfter?: Date | string | FirebaseFirestore.Timestamp;
    } = {}
    ): Promise<Transaction[]> {
        let q: FirebaseFirestore.Query<Transaction> = this.col.where("tgid", "==", tgid);

        if (opts.from) q = q.where("date", ">=", opts.from);
        if (opts.to)   q = q.where("date", "<=", opts.to);

        q = q.orderBy("date", opts.order ?? "desc");

        if (opts.startAfter) {
            const cursor =
            typeof opts.startAfter === "string"
                ? new Date(opts.startAfter)
                : opts.startAfter;
            q = q.startAfter(cursor as any); 
        }

        if (opts.limit) q = q.limit(opts.limit);

        const snap = await q.get();

        console.log(
        "[getByTgid] tgid=", JSON.stringify(tgid),
        "size=", snap.size,
        "ids=", snap.docs.map(d => d.id)
        );
        console.log(
        "[getByTgid] tgids=", snap.docs.map(d => JSON.stringify(d.get("tgid")))
        );

        return snap.docs.map(d => {
            const data = d.data();
            //const ts = (data as any).date as Date | FirebaseFirestore.Timestamp;
            //const date =
            //ts && typeof (ts as any).toDate === "function"
            //    ? (ts as FirebaseFirestore.Timestamp).toDate()
            //    : (ts as Date);

            return data;
        });
    }

}

