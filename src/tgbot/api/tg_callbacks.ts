import TelegramBot from "node-telegram-bot-api";
import crypto from 'crypto';
import { Status, StatusWith } from "../../status.js";
import { Journal } from "../journal.js";
import { Logic } from "../logic/abstracts.js";
import { return_fail } from "../utils.js";

function random_32bit_value(): string {
    return crypto.randomBytes(4).toString('hex');
}

type Callback = {
    fn: (params: any) => Promise<Status>;
    journal: Journal;
    params: any;
    debug_name?: string;
    single_shot?: boolean;
}

export class TelegramCallbacks extends Logic<void> {
    private callbacks: Map<string, Callback> = new Map();
    private queue: TelegramBot.CallbackQuery[] = [];

    constructor(private readonly journal: Journal) {
        super(100);
    }

    async proceed_impl(): Promise<StatusWith<void[]>> {
        const statuses: Status[] = [];
        for (const tg_callback of this.queue) {
            try {
                const status = await this.handle_callback(tg_callback);
                statuses.push(status);
            } catch (error) {
                statuses.push(Status.exception(error).wrap(`callback ${tg_callback.id} failed`));
            }
        }
        this.queue = [];
        return StatusWith.ok_and_warnings("callbacks processing", statuses);
    }

    add_callback(callback: Callback): string {
        const id = this.generate_id();
        this.callbacks.set(id, callback);
        return id;
    }

    on_callback(callback: TelegramBot.CallbackQuery): Status {
        this.journal.log().info(`On callback ${callback.id} received (${callback.data})`);
        this.queue.push(callback);
        return Status.ok();
    }

    remove_callback(id: string): void {
        this.callbacks.delete(id);
    }

    private async handle_callback(tg_callback: TelegramBot.CallbackQuery): Promise<Status> {
        if (tg_callback.data == undefined) {
            this.journal.log().error(`Callback query has no data: ${tg_callback.id}`);
            return Status.fail(`Callback query has no data: ${tg_callback.id}`).with([]);
        }
        const id = tg_callback.data;
        const callback = this.callbacks.get(id);
        if (callback) {
            try {
                const status = await callback.fn(callback.params);
                if (callback.single_shot) {
                    this.remove_callback(id);
                }
                return status;
            } catch (error) {
                this.remove_callback(id);
                return Status.exception(error).wrap(`callback ${callback.debug_name ?? ""} failed`);
            }
        } else {
            return return_fail(`callback ${id} not found`, this.journal.log()).with([]);
        }
    }

    private generate_id(): string {
        let id = "";
        do {
            id = `${random_32bit_value()}-${random_32bit_value()}`;
        } while (this.callbacks.has(id));
        return id;
    }

}