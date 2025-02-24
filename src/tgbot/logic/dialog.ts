import TelegramBot from 'node-telegram-bot-api';
import { Logic } from './abstracts.js';
import { UserLogic } from './user.js';
import { BaseActivity } from '../activities/base_activity.js';
import { MainActivity } from '../activities/main.js';
import { BotAPI } from '../api/telegram.js';
import { Status } from '../../status.js';

type Input = {
    what: "message",
    message: TelegramBot.Message;
} | {
    what: "callback",
    callback: TelegramBot.CallbackQuery;
}

export class Dialog extends Logic {

    private input_queue: Input[] = [];

    // activities stack
    private activity: BaseActivity | undefined;

    constructor(
        public readonly chat_id: number,
        public readonly user: UserLogic)
    {
        super();
    }

    start(): void {
        this.activity = new MainActivity(this);
        this.activity.start();
    }

    proceed(now: Date): void {
        const error_prefix = `${this.user.user.tgig} in dialog ${this.chat_id}:`;

        if (this.activity != undefined) {
            this.activity.proceed(now);
            for (const input of this.input_queue) {
                if (input.what == "message") {
                    const status = this.activity.on_message(input.message);
                    if (!status.is_ok()) {
                        console.error(`${error_prefix} ${status.what()}`);
                    }
                } else if (input.what == "callback") {
                    const status = this.activity.on_callback(input.callback);
                    if (!status.is_ok()) {
                        console.error(`${error_prefix} ${status.what()}`);
                    }
                }
            }
        }
        this.input_queue = [];
    }

    on_message(msg: TelegramBot.Message): Status {
        this.input_queue.push({ what: "message", message: msg });
        return Status.ok();
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

    static unpack(user: UserLogic, packed: ReturnType<typeof Dialog.pack>): Dialog {
        return new Dialog(packed[0], user);
    }
}
