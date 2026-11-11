import { Expected } from "../../dist/utils/expected.js";

// Test implementation of IMessagesBacklog using domain messages only.
export class MemoryMessagesBacklog {
    #messages = new Map();

    async init() {
        return Expected.ok(undefined);
    }

    async add_message(message) {
        if (this.#messages.has(message.message_id)) {
            return Expected.err(`Message '${message.message_id}' already exists`);
        }
        this.#messages.set(message.message_id, structuredClone(message));
        return Expected.ok(undefined);
    }

    async update_message(message) {
        const stored = this.#messages.get(message.message_id);
        if (!stored) {
            return Expected.err(`Message '${message.message_id}' not found`);
        }
        stored.text = message.text;
        return Expected.ok(undefined);
    }

    async get_messages(from, to) {
        return Expected.ok(structuredClone([...this.#messages.values()]
            .filter(message => message.time >= from && message.time <= to)
            .sort((a, b) => a.time.getTime() - b.time.getTime())));
    }

    async get_messages_by_ids(ids) {
        return Expected.ok(structuredClone([...new Set(ids)]
            .flatMap(id => this.#messages.has(id) ? [this.#messages.get(id)] : [])));
    }

    stored(id) {
        return structuredClone(this.#messages.get(id));
    }
}
