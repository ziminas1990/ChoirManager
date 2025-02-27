import TelegramBot from 'node-telegram-bot-api';
import { Logic } from './abstracts.js';
import { UserLogic } from './user.js';
import { BaseActivity } from '../activities/base_activity.js';
import { MainActivity } from '../activities/main.js';
import { BotAPI } from '../api/telegram.js';
import { Status, StatusWith } from '../../status.js';

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
    private activity: BaseActivity;

    static Start(user: UserLogic, chat_id: number): StatusWith<Dialog> {
        const dialog = new Dialog(user, chat_id);
        dialog.start();
        return StatusWith.ok().with(dialog);
    }

    private constructor(
        public readonly user: UserLogic,
        public readonly chat_id: number,
    ) {
        super();
        this.activity = new MainActivity(this);
    }

    private start(): void {
        this.activity.start();
    }

    async proceed(now: Date): Promise<Status> {
        const error_prefix = `${this.user.data.tgig} in dialog ${this.chat_id}:`;

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
        await BotAPI.instance().sendMessage(this.chat_id, msg);
        return Status.ok();
    }

    static pack(dialog: Dialog) {
        return [dialog.chat_id] as const;
    }

    static unpack(user: UserLogic, packed: ReturnType<typeof Dialog.pack>): StatusWith<Dialog> {
        return StatusWith.ok().with(new Dialog(user, packed[0]));
    }
}
