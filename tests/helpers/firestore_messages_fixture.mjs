import assert from "node:assert/strict";
import { mock } from "node:test";
import { Timestamp } from "@google-cloud/firestore";

import { GoogleAuth } from "../../dist/api/google_auth.js";
import { GoogleFirestore } from "../../dist/adapters/messages_storage/google_firestore.js";
import { TokenBucket } from "../../dist/utils/token_bucket.js";

export function firestore_fixture() {
    const records = new Map();
    const updates = [];
    const queries = [];
    const id_queries = [];
    let read_error;
    let write_error;
    let write_hook;
    function snapshot(record) {
        return { exists: record !== undefined,
            data: () => record === undefined ? undefined : {
                ...structuredClone(record), time: Timestamp.fromDate(record.time),
            } };
    }
    function query(filters = []) {
        return {
            where(field, operator, value) { return query([...filters, { field, operator, value }]); },
            orderBy() { return this; },
            async get() {
                queries.push(filters);
                const selected = [...records.values()].filter(record => filters.every(filter =>
                    filter.operator === ">=" ? record[filter.field] >= filter.value
                        : record[filter.field] <= filter.value));
                return { forEach(visit) {
                    for (const record of selected) {
                        visit(snapshot(record));
                    }
                } };
            },
        };
    }
    const collection = {
        ...query(),
        doc(id) {
            return {
                id,
                async create(data) {
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
                async update(patch) {
                    if (write_error) {
                        throw write_error;
                    }
                    assert.equal(records.has(id), true, "missing document");
                    updates.push(structuredClone(patch));
                    records.set(id, { ...records.get(id), ...structuredClone(patch) });
                },
            };
        },
    };
    mock.method(GoogleAuth, "get_firestore", () => ({
        collection: () => collection,
        async getAll(...refs) {
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
        fail_id_reads: error => { read_error = error; },
        fail_writes: error => { write_error = error; },
        block_writes: hook => { write_hook = hook; },
        create_backlog: () => new GoogleFirestore({ database_id: "test", collection_name: "managers" }, false),
        stored: id => [...records.values()].find(record => record.message_id === String(id)) };
}

function assert_no_undefined(value) {
    if (value && typeof value === "object") {
        for (const item of Object.values(value)) {
            assert.notEqual(item, undefined, "Firestore rejects undefined fields");
            assert_no_undefined(item);
        }
    }
}

