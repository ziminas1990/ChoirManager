import { mock } from "node:test";

import { MemoryMessagesBacklog } from "@src/adapters/messages_storage/memory.js";
import { Message } from "@src/interfaces/messages_backlog.js";
import { Expected } from "@src/utils/expected.js";

export function memory_fixture() {
    const backlog = new MemoryMessagesBacklog();
    const ranges: { from: Date; to: Date }[] = [];
    const id_reads: string[][] = [];
    const updates: Message[] = [];
    let read_error: Error | ((ids: string[]) => Error | undefined) | undefined;
    let write_error: Error | undefined;
    let write_hook: ((message: Message) => Promise<void>) | undefined;
    const get_messages = backlog.get_messages.bind(backlog);
    const get_messages_by_ids = backlog.get_messages_by_ids.bind(backlog);
    const add_message = backlog.add_message.bind(backlog);
    const update_message = backlog.update_message.bind(backlog);

    mock.method(backlog, "get_messages", async (from: Date, to: Date) => {
        ranges.push(structuredClone({ from, to }));
        return await get_messages(from, to);
    });
    mock.method(backlog, "get_messages_by_ids", async (ids: string[]) => {
        id_reads.push([...ids]);
        const error = typeof read_error === "function" ? read_error(ids) : read_error;
        return error
            ? Expected.exception("Message lookup failed", error)
            : await get_messages_by_ids(ids);
    });
    mock.method(backlog, "add_message", async (message: Message) => {
        if (write_hook) {
            await write_hook(message);
        }
        return write_error
            ? Expected.exception("Message write failed", write_error)
            : await add_message(message);
    });
    mock.method(backlog, "update_message", async (message: Message) => {
        if (write_error) {
            return Expected.exception("Message update failed", write_error);
        }
        const updated = await update_message(message);
        if (updated.ok) {
            updates.push(structuredClone(message));
        }
        return updated;
    });

    return {
        backlog, ranges, id_reads, updates,
        fail_id_reads: (error: typeof read_error) => { read_error = error; },
        fail_writes: (error?: Error) => { write_error = error; },
        block_writes: (hook: (message: Message) => Promise<void>) => { write_hook = hook; },
        create_backlog: () => backlog,
        stored: (id: string | number) => backlog.stored(String(id)),
    };
}
