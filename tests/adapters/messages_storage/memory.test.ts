import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryMessagesBacklog } from "@src/adapters/messages_storage/memory.js";
import { Message } from "@src/interfaces/messages_backlog.js";

import { value } from "@tests/helpers/expected.js";

function message(id: string, time: number, reply_to?: string | null): Message {
    return { message_id: id, sender_id: "author", text: id, time: new Date(time),
        ...(reply_to !== undefined ? { reply_to } : {}) };
}

test("memory backlog isolates roots and rejects duplicate identities", async () => {
    // Motivation: an in-memory adapter must provide reliable storage semantics
    // independently of the components that use it as their persistence layer.

    // 1. initialize independent stores and persist a mutable message
    const first = new MemoryMessagesBacklog();
    const second = new MemoryMessagesBacklog();
    const original = message("first", 1000, null);
    {
        value(await first.init());
        value(await second.init());
        value(await first.add_message(original));
    }

    // 2. mutate the input and reject a conflicting write without replacing it
    {
        original.text = "Caller mutation";
        original.time.setTime(0);
        assert.equal((await first.add_message(message("first", 2000))).ok, false);
        assert.deepEqual(value(await first.get_messages_by_ids(["first"])), [message("first", 1000, null)]);
        assert.deepEqual(value(await second.get_messages_by_ids(["first"])), []);
    }
});

test("memory backlog returns ordered inclusive ranges and detached ID lookups", async () => {
    // Motivation: consumers must see the same history boundaries and identities
    // as persistent backlogs without gaining mutable references to stored data.

    // 1. persist unsorted messages with all three reply metadata states
    const backlog = new MemoryMessagesBacklog();
    {
        for (const entry of [message("last", 3000, "first"),
            message("first", 1000, null), message("middle", 2000)]) {
            value(await backlog.add_message(entry));
        }
    }

    // 2. select exact endpoints, retaining the unknown state of a legacy record
    {
        const result = value(await backlog.get_messages(new Date(1000), new Date(2000)));
        assert.deepEqual(result, [message("first", 1000, null), message("middle", 2000)]);
        assert.equal(Object.hasOwn(result[1], "reply_to"), false);
        result[0].text = "Range mutation";
        result[1].time.setTime(0);
    }

    // 3. omit missing IDs and duplicates while keeping caller order and isolation
    {
        const result = value(await backlog.get_messages_by_ids(["last", "missing", "first", "last"]));
        assert.deepEqual(result, [message("last", 3000, "first"), message("first", 1000, null)]);
        result[0].text = "Lookup mutation";
        assert.deepEqual(value(await backlog.get_messages_by_ids(["last"])), [message("last", 3000, "first")]);
        assert.deepEqual(value(await backlog.get_messages_by_ids([])), []);
        assert.deepEqual(value(await backlog.get_messages(new Date(4000), new Date(5000))), []);
    }
});

test("memory backlog edits only text and reports missing messages", async () => {
    // Motivation: Telegram edit events can omit or contradict metadata, so
    // updating text must preserve the original author, date, and reply link.

    // 1. save an original reply
    const backlog = new MemoryMessagesBacklog();
    const original = message("reply", 1000, "parent");
    {
        value(await backlog.add_message(original));
    }

    // 2. apply an edit with unrelated metadata and verify the stored identity
    {
        value(await backlog.update_message({ ...message("reply", 0), sender_id: "wrong", text: "Edited" }));
        assert.deepEqual(value(await backlog.get_messages_by_ids(["reply"])), [{ ...original, text: "Edited" }]);
    }

    // 3. report an unknown identity without inserting a new message
    {
        const result = await backlog.update_message(message("missing", 2000));
        assert.equal(result.ok, false);
        assert.match(result.error, /not found/);
        assert.deepEqual(value(await backlog.get_messages_by_ids(["missing"])), []);
    }
});
