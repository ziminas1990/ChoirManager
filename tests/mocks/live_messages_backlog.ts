import { Message } from "@src/interfaces/messages_backlog.js";
import { Expected } from "@src/utils/expected.js";

import { mock_messages_backlog } from "./messages_backlog.js";

export function live_messages_backlog(records: Message[]) {
    const backlog = mock_messages_backlog();
    // Keep the supplied array live to model an independent writer.
    const get_messages = async (from: Date, to: Date) => {
        backlog.ranges.push({ from, to });
        return backlog.failures.range ? Expected.err<Message[]>(backlog.failures.range)
            : Expected.ok(records.filter(message => message.time >= from && message.time <= to));
    };
    const get_messages_by_ids = async (ids: string[]) => {
        backlog.ids.push(ids);
        return backlog.failures.ids ? Expected.err<Message[]>(backlog.failures.ids)
            : Expected.ok(records.filter(message => ids.includes(message.message_id)));
    };
    return Object.assign(backlog, { get_messages, get_messages_by_ids,
        lookups: backlog.ids,
        fail_range(error?: string) { backlog.failures.range = error; },
        fail_lookup(error?: string) { backlog.failures.ids = error; },
    });
}
