import TelegramBot from 'node-telegram-bot-api';
import { Proceedable } from './abstracts.js';
import { User } from './user.js';
import { BaseActivity } from '../activities/base_activity.js';
import { MainActivity } from '../activities/main.js';
import { BotAPI } from '../globals.js';

type Input = {
    what: "message",
    message: TelegramBot.Message;
} | {
    what: "callback",
    callback: TelegramBot.CallbackQuery;
}

export class Dialog extends Proceedable {

    private input_queue: Input[] = [];

    // activities stack
    private activity: BaseActivity | undefined;

    constructor(
        public readonly chat_id: number,
        public readonly user: User)
    {
        super();
    }

    start(): void {
        this.activity = new MainActivity(this);
        this.activity.start();
    }

    proceed(now: Date): void {
        if (this.activity != undefined) {
            this.activity.proceed(now);
            for (const input of this.input_queue) {
                if (input.what == "message") {
                    this.activity.on_message(input.message);
                } else if (input.what == "callback") {
                    this.activity.on_callback(input.callback);
                }
            }
        }
        this.input_queue = [];
    }

    on_message(msg: TelegramBot.Message): void {
        this.input_queue.push({ what: "message", message: msg });
    }

    on_callback(query: TelegramBot.CallbackQuery): void {
        this.input_queue.push({ what: "callback", callback: query });
    }

    send_message(msg: string): void {
        BotAPI.instance().sendMessage(this.chat_id, msg);
    }

    static pack(dialog: Dialog) {
        return [dialog.chat_id] as const;
    }

    static unpack(user: User, packed: ReturnType<typeof Dialog.pack>): Dialog {
        return new Dialog(packed[0], user);
    }
}
