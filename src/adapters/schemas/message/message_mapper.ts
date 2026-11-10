import assert from "assert";

import { Message } from "@src/interfaces/messages_backlog.js";
import { MessageRecord } from "./message_record.js";

export function to_record(source: Message): Extract<MessageRecord, { schema: 1 }> {
    return {
        schema: 1,
        time: source.time,
        message_id: source.message_id,
        sender_id: source.sender_id,
        text: source.text,
        ...(source.reply_to !== undefined ? { reply_to: source.reply_to } : {}),
    };
}

export function to_entity(record: MessageRecord): Message {
    const latest = to_latest_version(record);
    return {
        time: latest.time,
        message_id: latest.message_id,
        sender_id: latest.sender_id,
        text: latest.text,
        ...(latest.reply_to !== undefined ? { reply_to: latest.reply_to } : {}),
    };
}

export function to_latest_version(record: MessageRecord): Extract<MessageRecord, { schema: 1 }> {
    let latest = record;
    if (latest.schema === undefined) {
        latest = {
            schema: 1,
            time: latest.time,
            message_id: latest.message_id,
            sender_id: latest.sender,
            text: latest.text,
        };
    }
    assert(latest.schema === 1, `Unsupported message schema: ${latest.schema}`);
    return latest;
}
