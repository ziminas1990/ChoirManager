import { IMessagesBacklog, Message } from "@src/interfaces/messages_backlog.js";
import { Expected } from "@src/utils/expected.js";

export type ChatContextSnapshot = {
    originals: Message[];
    window: Message[];
}

export class ChatContextBuilder {
    constructor(
        private readonly backlog: IMessagesBacklog,
        private readonly window_days: number,
    ) {
        if (!Number.isInteger(window_days) || window_days <= 0) {
            throw new Error("context window must be a positive integer number of days");
        }
    }

    async get_context(): Promise<Expected<ChatContextSnapshot>> {
        const now = new Date(Date.now());
        // Keep the history prefix stable throughout the UTC day for LLM caching.
        const from = new Date(now);
        from.setUTCHours(0, 0, 0, 0);
        from.setUTCDate(from.getUTCDate() - this.window_days);
        const recent = await this.backlog.get_messages(from, now);
        if (!recent.ok) {
            return recent.wrap_error("failed to load chat context window");
        }

        const messages = new Map(recent.value.map(message => [message.message_id, message]));
        const window_ids = new Set(messages.keys());
        const visited = new Set(window_ids);
        let pending = recent.value;
        while (pending.length > 0) {
            const ids = new Set<string>();
            for (const message of pending) {
                if (typeof message.reply_to === "string" && !visited.has(message.reply_to)) {
                    visited.add(message.reply_to);
                    ids.add(message.reply_to);
                }
            }
            if (ids.size === 0) {
                break;
            }

            const fetched = await this.backlog.get_messages_by_ids([...ids]);
            if (!fetched.ok) {
                return fetched.wrap_error("failed to load chat context reply chains");
            }
            pending = fetched.value;
            for (const message of pending) {
                messages.set(message.message_id, message);
            }
        }

        const originals = [...messages.values()].filter(message => !window_ids.has(message.message_id));
        const window = [...messages.values()].filter(message => window_ids.has(message.message_id));
        originals.sort((a, b) => a.time.getTime() - b.time.getTime());
        window.sort((a, b) => a.time.getTime() - b.time.getTime());
        return Expected.ok({ originals, window });
    }
}
