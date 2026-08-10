import { GoogleAuth } from "@src/api/google_auth.js";
import { Expected, Status } from "@src/utils/expected.js";
import { Transaction } from "@src/interfaces/transactions_storage.js";
import type { TransactionStorageConfig } from "@src/adapters/transactions_storage/factory.js";
import fs from "node:fs";
import path from "node:path";

export type OldTransaction = {
    date: Date,
    change: number,
    balance_after: number,
    tgid: string,
};

// function toDate(value: any): Date {
//     if (value instanceof Date) return value;
//     if (value && typeof value.toDate === "function") return value.toDate();
//     return new Date(value);
// }

type TransformResult =
    | { kind: "skip" }
    | { kind: "delete" }
    | { kind: "update", newDoc: Transaction };

export function loadTransactionStorageConfig(configPath: string): TransactionStorageConfig {
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw);
  const cfg = parsed?.deposit_service?.transactions;

  if (!isTransactionStorageConfig(cfg)) {
    throw new Error("config.deposit_service.transactions is missing or misconfigured");
  }
  return cfg;
}

function isTransactionStorageConfig(x: any): x is TransactionStorageConfig {
  return !!x
    && x.type === "google_firestore"
    && typeof x.read_only === "boolean"
    && typeof x.database_id === "string"
    && typeof x.collection_name === "string";
}

function transformTransaction(data: FirebaseFirestore.DocumentData): TransformResult {
    // Already migrated?
    if (typeof (data as any).before === "number" &&
        typeof (data as any).after === "number" &&
        typeof (data as any).type === "string") {
        return { kind: "skip" };
    }

    const change = (data as any).change;
    const balance_after = (data as any).balance_after;

    // delete zero-change transactions
    if (change === 0) {
        return { kind: "delete" };
    }

    const after = balance_after as number;
    const before = after - change;

    const tgid_value =
        (typeof (data as any).tgid === "string" && (data as any).tgid.length > 0)
            ? String((data as any).tgid)
            : "";

    if (tgid_value.length === 0) {
        // Invalid tgid – delete
        return { kind: "delete" };
    }

    const update: Transaction= {
        date: new Date(data.date._seconds * 1000),
        tgid: tgid_value,
        type: "balance",
        before,
        after
    };

    return { kind: "update", newDoc: update};
}

async function process_transactions(database_name: string, collection_name: string, dry_run: boolean = true): Promise<Status> {
    try {
        const db = GoogleAuth.get_firestore(database_name);
        const collection = db.collection(collection_name);

        console.log(`Reading all transactions from collection: ${collection_name}`);
        if (dry_run) {
            console.log("DRY RUN MODE: No changes will be made to the database");
        }

        const snapshot = await collection.get();
        if (snapshot.empty) {
            console.log("No transactions found");
            return Expected.ok(undefined);
        }

        console.log(`Found ${snapshot.size} transactions to inspect`);

        let scanned = 0, updated = 0, deleted = 0, skipped = 0;
        let batch = db.batch();
        let total_count = 0;
        const COMMIT_EVERY = 450;

        for (const doc of snapshot.docs) {
            scanned++;
            const data = doc.data();
            const res = transformTransaction(data);

            if (res.kind === "skip") {
                skipped++;
                continue;
            }

            if (res.kind === "delete") {
                console.log(`[DELETE] ${doc.ref.path}`);
                if (!dry_run) {
                    batch.delete(doc.ref);
                    total_count++;
                }
                deleted++;
            } else if (res.kind === "update") {
                const { before, after, date } = res.newDoc;
                console.log(`[OVERWRITE] date: ${date} ${doc.ref.path} before=${before} after=${after} type=balance`);
                if (!dry_run) {
                    batch.set(doc.ref, res.newDoc, { merge: false });
                    total_count++;
                }
                updated++;
            }

            if (!dry_run && total_count >= COMMIT_EVERY) {
                await batch.commit();
                batch = db.batch();
                total_count = 0;
            }
        }

        if (!dry_run && total_count > 0) {
            await batch.commit();
        }

        console.log(`Summary: scanned=${scanned}, updated=${updated}, deleted=${deleted}, skipped=${skipped}`);
        if (dry_run) {
            console.log("DRY RUN: to apply changes, run with dry_run=false");
        }

        return Expected.ok(undefined);
    } catch (error) {
        return (((error) instanceof Error) ? Expected.err((error).message) : Expected.err(String(error))).wrap_error("Failed to process transactions");
    }
}

async function main() {
    const cfgfile = path.join(process.cwd(), 'config', 'botcfg.json');
    const config = loadTransactionStorageConfig(cfgfile);
    const database_name = config.database_id;
    const collection_name = config.collection_name;
    const google_cloud_key_file = "./config/google_cloud_key.json";
    const dry_run = false; // Set to false to actually apply changes

    console.log("Starting Firestore transaction updater...");
    console.log(`Database: ${database_name}`);
    console.log(`Collection/Group: ${collection_name}`);
    console.log(`Dry run mode: ${dry_run ? 'ENABLED' : 'DISABLED'}`);

    // Initialize Google Auth
    console.log("Initializing Google Auth...");
    const auth_status = await GoogleAuth.authenticate(google_cloud_key_file);
    if (!auth_status.ok) {
        console.error(`Google Auth failed: ${auth_status.error}`);
        process.exit(1);
    }
    console.log("Google Auth initialized successfully");

    // Process transactions
    const process_status = await process_transactions(database_name, collection_name, dry_run);
    if (!process_status.ok) {
        console.error(`Failed to process transactions: ${process_status.error}`);
        process.exit(1);
    }

    console.log("Firestore transaction updater completed successfully");
}

main().catch(error => {
    console.error("Unexpected error:", error);
    process.exit(1);
});
