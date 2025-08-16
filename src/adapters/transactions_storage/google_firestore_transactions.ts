//import { db, Timestamp } from "./transactions_storage.js";
import { Transaction } from "@src/database";
import { GoogleAuth } from "@src/api/google_auth.js";
import {
  Firestore,
  CollectionReference,
} from "@google-cloud/firestore";



export class FirestoreTransactionsStorage {
    private db: Firestore;
    private readonly col: CollectionReference<Transaction>;

    constructor() {
        this.db = GoogleAuth.get_firestore("(default)");
        this.col = this.db.collection("transactions") as CollectionReference<Transaction>;
    }

    public async logBalanceChange(e: Transaction) {
        await this.col.add(e);
    }

    // внутри class FirestoreTransactionsStorage
// предполагаю, что this.col: CollectionReference<Transaction>

    public async getByTgid(
    tgid: string,
    opts: { limit?: number; order?: "asc" | "desc" } = {}
    ): Promise<Transaction[]> {
        const normTgid = tgid.trim().toLowerCase();
        const order = opts.order ?? "desc";

        let q = this.col.where("tgid", "==", normTgid).orderBy("date", order);
        if (opts.limit) q = q.limit(opts.limit);

        const snap = await q.get();
        return snap.docs.map(d => {
            const x: any = d.data();
            const v = x.date;
            x.date = v && typeof v.toDate === "function" ? v.toDate() : new Date(v);
            return x as Transaction;
        });
    }


    public async getByTgid2(
    tgid: string,
    opts: {
        limit?: number;
        order?: "asc" | "desc";
        from?: Date;               // включительно
        to?: Date;                 // включительно
        startAfter?: Date | string | FirebaseFirestore.Timestamp; // для пагинации
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
            q = q.startAfter(cursor as any); // cursor должен соответствовать orderBy (здесь по date)
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

