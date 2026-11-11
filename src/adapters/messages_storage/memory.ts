import { Expected, Status } from "@src/utils/expected.js";

import { IMessagesBacklog, Message } from "@src/interfaces/messages_backlog.js";

export class MemoryMessagesBacklog implements IMessagesBacklog {
    #messages = new Map<string, Message>();

    async init(): Promise<Status> {
        return Expected.ok(undefined);
    }

    async add_message(message: Message): Promise<Status> {
        if (this.#messages.has(message.message_id)) {
            return Expected.err(`Message '${message.message_id}' already exists`);
        }
        this.#messages.set(message.message_id, structuredClone(message));
        return Expected.ok(undefined);
    }

    async update_message(message: Message): Promise<Status> {
        const stored = this.#messages.get(message.message_id);
        if (!stored) {
            return Expected.err(`Message '${message.message_id}' not found`);
        }
        stored.text = message.text;
        return Expected.ok(undefined);
    }

    async get_messages(from: Date, to: Date): Promise<Expected<Message[]>> {
        return Expected.ok(structuredClone([...this.#messages.values()]
            .filter(message => message.time >= from && message.time <= to)
            .sort((a, b) => a.time.getTime() - b.time.getTime())));
    }

    async get_messages_by_ids(ids: string[]): Promise<Expected<Message[]>> {
        return Expected.ok(structuredClone([...new Set(ids)]
            .flatMap(id => {
                const message = this.#messages.get(id);
                return message ? [message] : [];
            })));
    }

    stored(id: string): Message | undefined {
        return structuredClone(this.#messages.get(id));
    }
}
