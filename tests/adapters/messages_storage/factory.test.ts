import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, mock, test } from "node:test";

import { MessagesStorageConfig, MessagesStorageFactory } from "@src/adapters/messages_storage/factory.js";
import { GoogleFirestore } from "@src/adapters/messages_storage/google_firestore.js";
import { GoogleAuth } from "@src/api/google_auth.js";
import { ChatContextBuilder } from "@src/components/chat_context_builder.js";
import { MemoryJournal } from "@src/components/memory_journal.js";

import { object } from "@tests/helpers/objects.js";
import { invalid_result } from "@tests/helpers/untyped_boundary.js";
import { firestore_fixture } from "@tests/mocks/firestore.js";

afterEach(() => mock.restoreAll());

const journal = new MemoryJournal();

const firestore_config: MessagesStorageConfig = { type: "firestore", database_id: "test", collection_name: "messages",
    read_only: false };

test("nested backlog configs share cached storage with ChatContextBuilder", async () => {
    // Motivation: the factory must construct all configured layers so runtime
    // context reads can reuse the same backlog as direct message writes.

    // 1. provide Firestore records and count reads at the external boundary
    const storage = firestore_fixture();
    const reads = storage.queries;
    const id_reads = storage.id_queries;
    {
        mock.method(Date, "now", () => Date.parse("2026-11-10T12:00:00Z"));
        const source = storage.create_backlog();
        for (const message of [
            { message_id: "old", sender_id: "author", text: "Original",
                time: new Date("2026-10-01T12:00:00Z"), reply_to: null },
            { message_id: "reply", sender_id: "author", text: "Reply",
                time: new Date("2026-11-10T11:00:00Z"), reply_to: "old" },
        ]) {
            assert.equal((await source.add_message(message)).ok, true);
        }
    }

    // 2. create nested caches and pass the resulting backlog to the context
    let backlog;
    let context;
    {
        const config: MessagesStorageConfig = { type: "local_cache", window_days: 5, underlying: {
            type: "local_cache", window_days: 7, underlying: firestore_config,
        } };
        const created = MessagesStorageFactory.create(config, journal);
        assert.equal(created.ok, true);
        assert.equal((await created.value.init()).ok, true);
        backlog = created.value;
        context = new ChatContextBuilder(backlog, 3);
        assert.equal(reads.length, 0);
    }

    // 3. load the configured underlying window and resolve an old original once
    {
        const result = await context.get_context();
        assert.equal(result.ok, true);
        assert.deepEqual(result.value.originals.map(message => message.message_id), ["old"]);
        assert.deepEqual(result.value.window.map(message => message.message_id), ["reply"]);
        assert.equal(reads[0][0].value.toISOString(), "2026-11-03T00:00:00.000Z");
        assert.deepEqual(id_reads, [["old"]]);
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
        await new Promise<void>(resolve => setImmediate(resolve));
        assert.equal(storage.stored("new")!.message_id, "new");
        assert.equal(reads.length, 1);
        assert.deepEqual(id_reads, [["old"]]);
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
    const cases: [unknown, RegExp][] = [
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
    ];
    for (const [config, error] of cases) {
        const verified = invalid_result(MessagesStorageFactory.verify.bind(MessagesStorageFactory), config);
        assert.equal(verified.ok, false);
        assert.match(verified.error, error);
        const created = invalid_result(MessagesStorageFactory.create.bind(MessagesStorageFactory), config, journal);
        assert.equal(created.ok, false);
        assert.match(created.error, error);
    }
});

test("backlog factory accepts the nested template and preserves direct Firestore configs", () => {
    // Motivation: explicit cache configuration must work alongside direct
    // backlogs, including the existing google_firestore name used by announces.

    // 1. verify the public template has a valid explicit cache layer
    {
        const template = object(JSON.parse(readFileSync(new URL("../../../config/botcfg.template.json", import.meta.url), "utf8")));
        const config = object(object(template.managers_chat).backlog);
        const underlying = object(config.underlying);
        assert.equal(config.type, "local_cache");
        assert.equal(underlying.type, "firestore");
        const configured = { ...config, underlying: { ...underlying, database_id: "test" } };
        assert.equal(invalid_result(MessagesStorageFactory.verify.bind(MessagesStorageFactory), configured).ok, true);
    }

    // 2. construct both supported leaf names without adding an implicit cache
    {
        firestore_fixture();
        for (const type of ["firestore", "google_firestore"] as const) {
            const created = MessagesStorageFactory.create({ ...firestore_config, type }, journal);
            assert.equal(created.ok, true);
            assert.ok(created.value instanceof GoogleFirestore);
        }
    }
});
