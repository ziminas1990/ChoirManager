import crypto from 'crypto';
import TelegramBot from "node-telegram-bot-api";
import { Expected, Status } from "@src/utils/expected.js";
import { Journal } from '@src/journal.js';
import { Logic } from '@src/logic/abstracts.js';
import { return_fail } from '@src/utils.js';


function random_32bit_value(): string {
    return crypto.randomBytes(4).toString('hex');
}

type Callback = {
    fn: () => Promise<Status>;
    journal: Journal;
    debug_name?: string;
    single_shot?: boolean;
    valid_until?: number;
}

export class TelegramCallbacks extends Logic<void> {
    private callbacks: Map<string, Callback> = new Map();

    constructor(private readonly journal: Journal) {
        super(100);
    }

    async proceed_impl(now: Date): Promise<Expected<void[]>> {
        // Remove expired callbacks
        for (const [id, callback] of this.callbacks) {
            if (callback.valid_until && callback.valid_until < now.getTime()) {
                this.callbacks.delete(id);
            }
        }
        return Expected.ok([]);
    }

    add_callback(callback: Callback, lifetime_sec?: number): string {
        const id = this.generate_id();
        if (lifetime_sec && lifetime_sec > 0) {
            callback.valid_until = Date.now() + lifetime_sec * 1000;
        }
        this.callbacks.set(id, callback);
        return id;
    }

    async on_callback(tg_callback: TelegramBot.CallbackQuery): Promise<Status> {
        this.journal.log().info(`On callback ${tg_callback.id} received (${tg_callback.data})`);
        if (tg_callback.data == undefined) {
            this.journal.log().error(`Callback query has no data: ${tg_callback.id}`);
            return Expected.err(`Callback query has no data: ${tg_callback.id}`);
        }
        const id = tg_callback.data;
        const callback = this.callbacks.get(id);
        if (callback) {
            try {
                const status = await callback.fn();
                if (callback.single_shot) {
                    this.remove_callback(id);
                }
                return status;
            } catch (error) {
                this.remove_callback(id);
                return (((error) instanceof Error) ? Expected.err((error).message) : Expected.err(String(error))).wrap_error(`callback '${callback.debug_name ?? ""}' failed`);
            }
        } else {
            return return_fail(`callback ${id} not found`, this.journal.log());
        }
    }

    remove_callback(id: string): boolean {
        return this.callbacks.delete(id);
    }

    private generate_id(): string {
        let id = "";
        do {
            id = `${random_32bit_value()}-${random_32bit_value()}`;
        } while (this.callbacks.has(id));
        return id;
    }

}