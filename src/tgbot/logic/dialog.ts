import assert from 'assert';
import TelegramBot from 'node-telegram-bot-api';

import { Logic } from './abstracts.js';
import { UserLogic } from './user.js';
import { BaseActivity } from '../activities/base_activity.js';
import { MainActivity } from '../activities/main.js';
import { BotAPI } from '../api/telegram.js';
import { Status, StatusWith } from '../../status.js';
import { GuestActivity } from '../activities/guest_activity.js';

type Input = {
    what: "message",
    message: TelegramBot.Message;
} | {
    what: "callback",
    callback: TelegramBot.CallbackQuery;
}

export class Dialog extends Logic<void> {

    private input_queue: Input[] = [];

    // activities stack
    private activity: BaseActivity;

    static async Start(user: UserLogic, chat_id: number): Promise<StatusWith<Dialog>> {
        const dialog = new Dialog(user, chat_id);
        const status = await dialog.start();
        if (!status.done()) {
            return status.wrap("failed to start dialog");
        }
        return StatusWith.ok().with(dialog);
    }

    private constructor(
        public readonly user: UserLogic,
        public readonly chat_id: number,
    ) {
        super(100);
        assert(chat_id);
        this.activity = user.is_guest() ? new GuestActivity(this) : new MainActivity(this);
    }

    private async start(): Promise<Status> {
        return await this.activity.start();
    }

    async proceed_impl(now: Date): Promise<Status> {
        const error_prefix = `${this.user.data.tgid} in dialog ${this.chat_id}:`;

        if (this.activity != undefined) {
            this.activity.proceed(now);
            for (const input of this.input_queue) {
                if (input.what == "message") {
                    const status = await this.activity.on_message(input.message);
                    if (!status.done()) {
                        console.error(`${error_prefix} ${status.what()}`);
                    }
                } else if (input.what == "callback") {
                    const status = await this.activity.on_callback(input.callback);
                    if (!status.done()) {
                        console.error(`${error_prefix} ${status.what()}`);
                    }
                }
            }
        }
        this.input_queue = [];
        return Status.ok();
    }

    on_message(msg: TelegramBot.Message): Status {
        this.input_queue.push({ what: "message", message: msg });
        return Status.ok();
    }

    on_callback(query: TelegramBot.CallbackQuery): Status {
        this.input_queue.push({ what: "callback", callback: query });
        return Status.ok();
    }

    async send_message(msg: string): Promise<Status> {
        if (this.chat_id) {
            console.log(`Sending to ${this.chat_id}: ${msg}`);
            await BotAPI.instance().sendMessage(this.chat_id, msg);
            return Status.ok();
        } else {
            return Status.fail("Chag id is NOT set")
        }
    }

    static pack(dialog: Dialog) {
        return [dialog.chat_id] as const;
    }

    static unpack(user: UserLogic, packed: ReturnType<typeof Dialog.pack>): StatusWith<Dialog> {
        return StatusWith.ok().with(new Dialog(user, packed[0]));
    }
}
