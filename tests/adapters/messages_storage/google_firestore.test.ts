import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

import { firestore_fixture } from "@tests/mocks/firestore.js";

afterEach(() => mock.restoreAll());

test("Firestore edits preserve message metadata and propagate failed writes", async () => {
    // Motivation: editing text must leave the original domain metadata intact,
    // and SDK write failures must be returned through the backlog contract.

    // 1. store a reply in the current document format
    let context;
    let backlog;
    const original = { time: new Date("2026-11-09T12:00:00Z"), message_id: "reply",
        sender_id: "original-author", text: "Original reply", reply_to: "parent" };
    {
        context = firestore_fixture();
        backlog = context.create_backlog();
        assert.equal((await backlog.add_message(original)).ok, true);
        assert.deepEqual(context.stored("reply"), { schema: 1, ...original });
    }

    // 2. send an edit whose other metadata differs from the saved message
    {
        const edited = { time: new Date("2026-11-10T13:00:00Z"), message_id: "reply",
            sender_id: "other-author", text: "Edited reply" };
        assert.equal((await backlog.update_message(edited)).ok, true);
        assert.deepEqual(context.updates, [{ text: "Edited reply" }]);
        assert.deepEqual(context.stored("reply"), { schema: 1, ...original, text: "Edited reply" });
    }

    // 3. reload the domain message through both storage read APIs
    {
        const reloaded = context.create_backlog();
        const by_ids = await reloaded.get_messages_by_ids(["reply"]);
        const by_time = await reloaded.get_messages(new Date("2026-11-09T00:00:00Z"),
            new Date("2026-11-10T00:00:00Z"));
        assert.equal(by_ids.ok, true);
        assert.equal(by_time.ok, true);
        assert.deepEqual(by_ids.value, [{ ...original, text: "Edited reply" }]);
        assert.deepEqual(by_time.value, by_ids.value);
    }

    // 4. report failed creates and edits without changing stored data
    {
        context.fail_writes(new Error("Write unavailable"));
        const added = await backlog.add_message({ ...original, message_id: "failed" });
        const updated = await backlog.update_message({ ...original, text: "Failed edit" });
        assert.equal(added.ok, false);
        assert.equal(updated.ok, false);
        assert.match(added.error, /Write unavailable/);
        assert.match(updated.error, /Write unavailable/);
        assert.equal(context.stored("failed"), undefined);
        assert.deepEqual(context.stored("reply"), { schema: 1, ...original, text: "Edited reply" });
    }
});

test("batch lookup handles duplicate, missing, and empty IDs and propagates read failures", async () => {
    // Motivation: callers must distinguish missing messages from storage
    // errors, while requesting many references without a separate read for each
    // ID.

    // 1. store messages outside the normal history range
    let context;
    let backlog;
    {
        context = firestore_fixture();
        backlog = context.create_backlog();
        const time = new Date(Date.now() - 10 * 86400_000);
        assert.equal((await backlog.add_message({
            time, message_id: "first", sender_id: "author", text: "First", reply_to: null,
        })).ok, true);
        assert.equal((await backlog.add_message({
            time, message_id: "second", sender_id: "author", text: "Second", reply_to: "first",
        })).ok, true);
        assert.equal(context.stored("first")!.schema, 1);
        assert.equal(context.stored("first")!.sender_id, "author");
        assert.equal(Object.hasOwn(context.stored("first")!, "sender"), false);
        assert.equal((await backlog.add_message({
            time, message_id: "legacy", sender_id: "old-author", text: "Old message",
        })).ok, true);
        const legacy = context.stored("legacy")!;
        legacy.sender = legacy.sender_id;
        delete legacy.sender_id;
        delete legacy.schema;
    }

    // 2. fetch a set in one request, returning each existing message once
    {
        const result = await backlog.get_messages_by_ids(["second", "missing", "first", "second", "legacy"]);
        assert.equal(result.ok, true);
        assert.deepEqual(result.value.map(message => message.message_id), ["second", "first", "legacy"]);
        assert.equal(result.value[0].reply_to, "first");
        assert.equal(result.value[1].reply_to, null);
        assert.equal(Object.hasOwn(result.value[2], "reply_to"), false);
        assert.equal(result.value[2].sender_id, "old-author");
        assert.ok(result.value[0].time instanceof Date);
        assert.equal(context.id_queries.length, 1);
        assert.equal(context.id_queries[0].length, 4);
    }

    // 3. skip storage completely for an empty set
    {
        const result = await backlog.get_messages_by_ids([]);
        assert.equal(result.ok, true);
        assert.equal(result.value.length, 0);
        assert.equal(context.id_queries.length, 1);
    }

    // 4. return a failed storage lookup as an error
    {
        context.fail_id_reads(new Error("Firestore unavailable"));
        const result = await backlog.get_messages_by_ids(["first"]);
        assert.equal(result.ok, false);
        assert.match(result.error, /Firestore unavailable/);
    }

    // 5. reject unknown schema versions through both storage read APIs
    {
        context.fail_id_reads(undefined);
        context.stored("first")!.schema = 99;
        const by_ids = await backlog.get_messages_by_ids(["first"]);
        assert.equal(by_ids.ok, false);
        assert.match(by_ids.error, /Unsupported message schema: 99/);
        const by_time = await backlog.get_messages(new Date(0), new Date());
        assert.equal(by_time.ok, false);
        assert.match(by_time.error, /Unsupported message schema: 99/);
    }
});
