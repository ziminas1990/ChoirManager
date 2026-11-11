import { IMessagesBacklog, Message } from "@src/interfaces/messages_backlog.js";
import { Expected } from "@src/utils/expected.js";

// A controllable contract double. Public records also allow tests to model
// changes made by another writer between component calls.
export function mock_messages_backlog(messages: Message[] = []) {
    const records = new Map(messages.map(message => [message.message_id, structuredClone(message)]));
    const ranges: { from: Date; to: Date }[] = [];
    const ids: string[][] = [];
    const failures: Partial<Record<"init" | "add" | "update" | "range" | "ids", string>> = {};
    let range_hook: (() => Promise<void>) | undefined;
    const backlog = {
        records, ranges, ids, failures,
        block_range(hook: () => Promise<void>) { range_hook = hook; },
        async init() {
            return failures.init ? Expected.err(failures.init) : Expected.ok(undefined);
        },
        async add_message(message: Message) {
            if (failures.add) return Expected.err(failures.add);
            records.set(message.message_id, structuredClone(message));
            return Expected.ok(undefined);
        },
        async update_message(message: Message) {
            if (failures.update) return Expected.err(failures.update);
            const record = records.get(message.message_id);
            if (!record) return Expected.err("missing message");
            record.text = message.text;
            return Expected.ok(undefined);
        },
        async get_messages(from: Date, to: Date) {
            ranges.push({ from, to });
            if (failures.range) return Expected.err(failures.range);
            const selected = structuredClone([...records.values()].filter(
                message => message.time >= from && message.time <= to));
            await range_hook?.();
            return Expected.ok(selected);
        },
        async get_messages_by_ids(requested: string[]) {
            ids.push(requested);
            if (failures.ids) return Expected.err(failures.ids);
            return Expected.ok(structuredClone(requested.flatMap(id => {
                const message = records.get(id);
                return message ? [message] : [];
            })));
        },
    } satisfies IMessagesBacklog & {
        records: Map<string, Message>;
        ranges: { from: Date; to: Date }[];
        ids: string[][];
        failures: typeof failures;
        block_range(hook: () => Promise<void>): void;
    };
    return backlog;
}
