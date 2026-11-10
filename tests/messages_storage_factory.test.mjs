import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { readFileSync } from "node:fs";
import { Timestamp } from "@google-cloud/firestore";

import { GoogleAuth } from "../dist/api/google_auth.js";
import { GoogleFirestore } from "../dist/adapters/messages_storage/google_firestore.js";
import { MessagesStorageFactory } from "../dist/adapters/messages_storage/factory.js";
import { ChatContextBuilder } from "../dist/components/chat_context_builder.js";
import { TokenBucket } from "../dist/utils/token_bucket.js";

afterEach(() => mock.restoreAll());

const journal = { child() { return this; }, log: () => ({ error() {} }) };

const firestore_config = { type: "firestore", database_id: "test", collection_name: "messages",
    read_only: false };

test("nested backlog configs share cached storage with ChatContextBuilder", async () => {
    // Motivation: the factory must construct all configured layers so runtime
    // context reads can reuse the same backlog as direct message writes.

    // 1. provide Firestore records and count reads at the external boundary
    let records;
    const reads = [];
    const id_reads = [];
    {
        mock.method(Date, "now", () => Date.parse("2026-11-10T12:00:00Z"));
        records = [
            { schema: 1, message_id: "old", sender_id: "author", text: "Original",
                time: new Date("2026-10-01T12:00:00Z"), reply_to: null },
            { schema: 1, message_id: "reply", sender_id: "author", text: "Reply",
                time: new Date("2026-11-10T11:00:00Z"), reply_to: "old" },
        ];
        function snapshot(record) {
            return { exists: true, data: () => ({ ...record, time: Timestamp.fromDate(record.time) }) };
        }
        function query(filters = []) {
            return {
                where(field, op, value) { return query([...filters, { field, op, value }]); },
                orderBy() { return this; },
                async get() {
                    reads.push(filters);
                    const selected = records.filter(record => filters.every(filter => filter.op === ">="
                        ? record[filter.field] >= filter.value : record[filter.field] <= filter.value));
                    return { forEach(visit) { selected.forEach(record => visit(snapshot(record))); } };
                },
            };
        }
        mock.method(GoogleAuth, "get_firestore", () => ({
            collection: () => ({ ...query(), doc: () => ({
                async create(record) { records.push(structuredClone(record)); },
            }) }),
            async getAll(...refs) {
                id_reads.push(refs.length);
                return [snapshot(records[0])];
            },
        }));
        mock.method(TokenBucket.prototype, "wait_tokens", async () => {});
    }

    // 2. create nested caches and pass the resulting backlog to the context
    let backlog;
    let context;
    {
        const config = { type: "local_cache", window_days: 5, underlying: {
            type: "local_cache", window_days: 7, underlying: firestore_config,
        } };
        const created = MessagesStorageFactory.create(config, journal);
        assert.equal(created.ok, true);
        assert.equal((await created.value.init()).ok, true);
        backlog = created.value;
        context = new ChatContextBuilder(backlog, 3);
        assert.deepEqual(reads, []);
    }

    // 3. load the configured underlying window and resolve an old original once
    {
        const result = await context.get_context();
        assert.equal(result.ok, true);
        assert.deepEqual(result.value.originals.map(message => message.message_id), ["old"]);
        assert.deepEqual(result.value.window.map(message => message.message_id), ["reply"]);
        assert.equal(reads[0][0].value.toISOString(), "2026-11-03T00:00:00.000Z");
        assert.deepEqual(id_reads, [1]);
    }

    // 4. persist directly and reuse both cached layers for the next snapshot
    {
        const saved = await backlog.add_message({ message_id: "new", sender_id: "author", text: "New reply",
            time: new Date(Date.now()), reply_to: "old" });
        assert.equal(saved.ok, true);
        const result = await context.get_context();
        assert.equal(result.ok, true);
        assert.deepEqual(result.value.window.map(message => message.message_id), ["reply", "new"]);
        assert.deepEqual(result.value.originals.map(message => message.message_id), ["old"]);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(records.at(-1).message_id, "new");
        assert.equal(reads.length, 1);
        assert.deepEqual(id_reads, [1]);
    }
});

test("backlog factory validates every nested layer before constructing storage", () => {
    // Motivation: malformed nested configs must produce useful errors rather
    // than constructor exceptions or partially constructed Firestore clients.

    // 1. forbid storage creation while checking invalid configurations
    {
        mock.method(GoogleAuth, "get_firestore", () => {
            assert.fail("invalid configuration must not construct a storage client");
        });
    }

    // 2. reject invalid cache windows, missing children and broken leaf configs
    for (const [config, error] of [
        [undefined, /type/],
        [{ type: "local_cache", window_days: 0, underlying: firestore_config }, /window_days/],
        [{ type: "local_cache", window_days: 1.5, underlying: firestore_config }, /window_days/],
        [{ type: "local_cache", window_days: 5 }, /underlying/],
        [{ type: "local_cache", window_days: 5, underlying: { type: "unknown" } }, /underlying.*unknown/],
        [{ type: "local_cache", window_days: 5, underlying: { ...firestore_config, read_only: undefined } },
            /underlying.*read_only/],
        [{ type: "local_cache", window_days: 5, underlying: { ...firestore_config, database_id: "" } },
            /underlying.*database_id/],
        [{ type: "local_cache", window_days: 5, underlying: { ...firestore_config, collection_name: "" } },
            /underlying.*collection_name/],
    ]) {
        const verified = MessagesStorageFactory.verify(config);
        assert.equal(verified.ok, false);
        assert.match(verified.error, error);
        const created = MessagesStorageFactory.create(config, journal);
        assert.equal(created.ok, false);
        assert.match(created.error, error);
    }
});

test("backlog factory accepts the nested template and preserves direct Firestore configs", () => {
    // Motivation: explicit cache configuration must work alongside direct
    // backlogs, including the existing google_firestore name used by announces.

    // 1. verify the public template has a valid explicit cache layer
    {
        const template = JSON.parse(readFileSync(new URL("../config/botcfg.template.json", import.meta.url)));
        const config = template.managers_chat.backlog;
        assert.equal(config.type, "local_cache");
        assert.equal(config.underlying.type, "firestore");
        const configured = { ...config, underlying: { ...config.underlying, database_id: "test" } };
        assert.equal(MessagesStorageFactory.verify(configured).ok, true);
    }

    // 2. construct both supported leaf names without adding an implicit cache
    {
        mock.method(GoogleAuth, "get_firestore", () => ({ collection: () => ({}) }));
        for (const type of ["firestore", "google_firestore"]) {
            const created = MessagesStorageFactory.create({ ...firestore_config, type }, journal);
            assert.equal(created.ok, true);
            assert.ok(created.value instanceof GoogleFirestore);
        }
    }
});
