import assert from "node:assert/strict";
import { test } from "node:test";

import { to_entity, to_latest_version, to_record } from "@src/adapters/schemas/message/message_mapper.js";

test("message serialization writes the current schema and preserves unknown reply state", () => {
    // Motivation: database writes must be versioned and omit unknown metadata
    // rather than accidentally recording a legacy message as a non-reply.

    // 1. prepare messages with every supported reply state
    let messages;
    {
        const base = { time: new Date("2026-11-09T12:00:00.123Z"),
            message_id: "20", sender_id: "author", text: "Yes, I agree" };
        messages = [base, { ...base, reply_to: null }, { ...base, reply_to: "10" }];
    }

    // 2. write the latest format and recover equivalent domain messages
    for (const message of messages) {
        const record = to_record(message);
        assert.equal(record.schema, 1);
        assert.equal(record.sender_id, "author");
        assert.equal(Object.hasOwn(record, "sender"), false);
        assert.equal(Object.hasOwn(record, "reply_to"), Object.hasOwn(message, "reply_to"));
        assert.deepEqual(to_entity(record), message);
    }
});

test("unversioned message records upgrade without inventing reply metadata", () => {
    // Motivation: v0 did not record reply relationships; migration must
    // preserve that uncertainty even when the message text sounds like a reply.

    // 1. prepare the historical storage format without reply metadata
    let legacy;
    let original;
    {
        legacy = { time: new Date("2025-09-27T09:27:30Z"), message_id: "8845",
            sender: "alexander_in_tg", text: "Мне кажется что да. Устанут." };
        original = structuredClone(legacy);
    }

    // 2. upgrade the record without modifying the input or adding reply_to
    {
        const latest = to_latest_version(legacy);
        assert.deepEqual(latest, { schema: 1, time: legacy.time, message_id: "8845",
            sender_id: "alexander_in_tg", text: legacy.text });
        assert.deepEqual(to_entity(legacy), {
            time: legacy.time, message_id: "8845", sender_id: "alexander_in_tg", text: legacy.text,
        });
        assert.equal(Object.hasOwn(latest, "reply_to"), false);
        assert.equal(Object.hasOwn(to_entity(legacy), "reply_to"), false);
        assert.deepEqual(legacy, original);
    }
});

test("unknown message schema versions fail explicitly", () => {
    // Motivation: future schema versions must not be silently interpreted as
    // current data by readers that do not know how to migrate them.

    // 1. prepare a message record with all historical fields
    let legacy;
    {
        legacy = { time: new Date("2026-11-08T12:00:00Z"), message_id: "20",
            sender: "author", text: "Old message" };
    }

    // 2. reject unsupported schemas at the migration and entity boundaries
    {
        assert.throws(() => Reflect.apply(to_latest_version, undefined, [{ ...legacy, schema: 2 }]), /Unsupported message schema: 2/);
        assert.throws(() => Reflect.apply(to_entity, undefined, [{ ...legacy, schema: 99 }]), /Unsupported message schema: 99/);
    }
});
