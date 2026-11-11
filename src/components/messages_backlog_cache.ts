import { IMessagesBacklog, Message } from "@src/interfaces/messages_backlog.js";
import { IJournal } from "@src/interfaces/journal.js";
import { Expected, Status } from "@src/utils/expected.js";
import { save_message } from "@src/utils/messages_backlog.js";

type CachedMessage = {
    message: Message;
    by_id: boolean;
    // Local changes take precedence over storage snapshots until eviction.
    local: boolean;
}

export class MessagesBacklogCache implements IMessagesBacklog {
    private readonly messages = new Map<string, CachedMessage>();
    private readonly edited_texts = new Map<string, string>();
    private loaded_from?: number;
    private pending: Promise<void> = Promise.resolve();
    private pending_writes: Promise<void> = Promise.resolve();

    constructor(
        private readonly underlying: IMessagesBacklog,
        private readonly window_days: number,
        private readonly journal: IJournal,
    ) {
        if (!Number.isInteger(window_days) || window_days <= 0) {
            throw new Error("cache window must be a positive integer number of days");
        }
    }

    async init(): Promise<Status> {
        return this.serialize(async () => await this.underlying.init());
    }

    async add_message(message: Message): Promise<Status> {
        const copy = structuredClone(message);
        this.edited_texts.delete(copy.message_id);
        this.remember(copy, false, true);
        this.prune();
        this.queue_write(copy, "add");
        return Expected.ok(undefined);
    }

    async update_message(message: Message): Promise<Status> {
        const copy = structuredClone(message);
        const cached = this.messages.get(copy.message_id);
        if (cached) {
            cached.message.text = copy.text;
            cached.local = true;
        } else {
            // Fetch the original metadata before applying an edit to an unseen message.
            this.edited_texts.set(copy.message_id, copy.text);
        }
        this.prune();
        this.queue_write(copy, "update");
        return Expected.ok(undefined);
    }

    async get_messages(from: Date, to: Date): Promise<Expected<Message[]>> {
        const from_ms = from.getTime();
        const to_ms = to.getTime();
        return this.serialize(async () => {
            const now = Date.now();
            const cutoff = this.prune();
            if (from_ms < cutoff || to_ms > now) {
                const result = await this.underlying.get_messages(new Date(from_ms), new Date(to_ms));
                if (!result.ok) {
                    return result;
                }
                const fetched = result.value.map(message => this.remember(message));
                this.prune();
                return Expected.ok(this.select_messages(from_ms, to_ms, fetched));
            }

            if (this.loaded_from === undefined || this.loaded_from > cutoff) {
                const result = await this.underlying.get_messages(new Date(cutoff), new Date(now));
                if (!result.ok) {
                    return result;
                }
                for (const message of result.value) {
                    this.remember(message);
                }
                this.loaded_from = cutoff;
            }

            return Expected.ok(this.select_messages(from_ms, to_ms));
        });
    }

    async get_messages_by_ids(ids: string[]): Promise<Expected<Message[]>> {
        const unique_ids = [...new Set(ids)];
        return this.serialize(async () => {
            this.prune();
            const missing = unique_ids.filter(id => !this.messages.has(id));
            if (missing.length > 0) {
                const result = await this.underlying.get_messages_by_ids(missing);
                if (!result.ok) {
                    return result;
                }
                for (const message of result.value) {
                    this.remember(message, true);
                }
            }

            const selected: Message[] = [];
            for (const id of unique_ids) {
                const cached = this.messages.get(id);
                if (cached) {
                    cached.by_id = true;
                    selected.push(cached.message);
                }
            }
            return Expected.ok(structuredClone(selected));
        });
    }

    private async serialize<T>(operation: () => Promise<T>): Promise<T> {
        // Concurrent readers share a successful window load; writes run independently.
        const result = this.pending.then(operation);
        this.pending = result.then(() => {}, () => {});
        return await result;
    }

    private queue_write(message: Message, operation: "add" | "update"): void {
        this.pending_writes = this.pending_writes.then(
            () => save_message(this.underlying, message, operation, this.journal));
    }

    private remember(message: Message, by_id: boolean = false, local: boolean = false): Message {
        const previous = this.messages.get(message.message_id);
        if (previous?.local && !local) {
            previous.by_id ||= by_id;
            return previous.message;
        }
        const copy = structuredClone(message);
        const edited_text = this.edited_texts.get(message.message_id);
        if (edited_text !== undefined) {
            copy.text = edited_text;
            this.edited_texts.delete(message.message_id);
            local = true;
        }
        this.messages.set(message.message_id, {
            message: copy,
            by_id: by_id || previous?.by_id === true,
            local,
        });
        return copy;
    }

    private select_messages(from: number, to: number, fetched: Message[] = []): Message[] {
        const messages = new Map(fetched.map(message => [message.message_id, message]));
        for (const item of this.messages.values()) {
            messages.set(item.message.message_id, item.message);
        }
        return structuredClone([...messages.values()]
            .filter(message => message.time.getTime() >= from && message.time.getTime() <= to)
            .sort((a, b) => a.time.getTime() - b.time.getTime()));
    }

    private prune(): number {
        const from = new Date(Date.now());
        from.setUTCHours(0, 0, 0, 0);
        from.setUTCDate(from.getUTCDate() - this.window_days);
        const cutoff = from.getTime();
        if (this.loaded_from !== undefined && this.loaded_from < cutoff) {
            this.loaded_from = cutoff;
        }
        for (const [id, item] of this.messages) {
            if (!item.by_id && item.message.time.getTime() < cutoff) {
                this.messages.delete(id);
            }
        }
        return cutoff;
    }
}
