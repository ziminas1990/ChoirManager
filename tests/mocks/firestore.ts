import assert from "node:assert/strict";
import { mock } from "node:test";

import { Timestamp } from "@google-cloud/firestore";

import { GoogleFirestore } from "@src/adapters/messages_storage/google_firestore.js";
import { MessageRecord } from "@src/adapters/schemas/message/message_record.js";
import { GoogleAuth } from "@src/api/google_auth.js";
import { TokenBucket } from "@src/utils/token_bucket.js";

type StoredRecord = {
    schema?: number; time: Date; message_id: string; text: string;
    sender?: string; sender_id?: string; reply_to?: string | null;
};
type Filter = { field: "time"; operator: ">=" | "<="; value: Date };
type ReadError = Error | ((ids: string[]) => Error | undefined) | undefined;

export function firestore_fixture() {
    const records = new Map<string, StoredRecord>();
    const updates: { text: string }[] = [];
    const queries: Filter[][] = [];
    const id_queries: string[][] = [];
    let read_error: ReadError;
    let write_error: Error | undefined;
    let write_hook: ((record: MessageRecord) => Promise<void>) | undefined;
    function snapshot(record: StoredRecord | undefined) {
        return { exists: record !== undefined,
            data: () => record === undefined ? undefined : {
                ...structuredClone(record), time: Timestamp.fromDate(record.time),
            } };
    }
    function query(filters: Filter[] = []) {
        return {
            where(field: "time", operator: ">=" | "<=", value: Date) { return query([...filters, { field, operator, value }]); },
            orderBy() { return this; },
            async get() {
                queries.push(filters);
                const selected = [...records.values()].filter(record => filters.every(filter =>
                    filter.operator === ">=" ? record[filter.field] >= filter.value
                        : record[filter.field] <= filter.value));
                return { forEach(visit: (document: ReturnType<typeof snapshot>) => void) {
                    for (const record of selected) {
                        visit(snapshot(record));
                    }
                } };
            },
        };
    }
    const collection = {
        ...query(),
        doc(id: string) {
            return {
                id,
                async create(data: MessageRecord) {
                    if (write_hook) {
                        await write_hook(data);
                    }
                    if (write_error) {
                        throw write_error;
                    }
                    assert.equal(records.has(id), false, "duplicate document");
                    assert_no_undefined(data);
                    records.set(id, structuredClone(data));
                },
                async update(patch: { text: string }) {
                    if (write_error) {
                        throw write_error;
                    }
                    assert.equal(records.has(id), true, "missing document");
                    updates.push(structuredClone(patch));
                    records.set(id, { ...records.get(id)!, ...structuredClone(patch) });
                },
            };
        },
    };
    mock.method(GoogleAuth, "get_firestore", () => ({
        collection: () => collection,
        async getAll(...refs: { id: string }[]) {
            const ids = refs.map(ref => records.get(ref.id)?.message_id ?? ref.id);
            id_queries.push(ids);
            const error = typeof read_error === "function" ? read_error(ids) : read_error;
            if (error) {
                throw error;
            }
            return refs.map(ref => snapshot(records.get(ref.id)));
        },
    }));
    mock.method(TokenBucket.prototype, "wait_tokens", async () => {});
    return { records, updates, queries, id_queries,
        fail_id_reads: (error: ReadError) => { read_error = error; },
        fail_writes: (error?: Error) => { write_error = error; },
        block_writes: (hook: (record: MessageRecord) => Promise<void>) => { write_hook = hook; },
        create_backlog: () => new GoogleFirestore({ database_id: "test", collection_name: "managers" }, false),
        stored: (id: string | number) => [...records.values()].find(record => record.message_id === String(id)) };
}

function assert_no_undefined(value: unknown) {
    if (value && typeof value === "object") {
        const items: unknown[] = Object.values(value);
        for (const item of items) {
            assert.notEqual(item, undefined, "Firestore rejects undefined fields");
            assert_no_undefined(item);
        }
    }
}
