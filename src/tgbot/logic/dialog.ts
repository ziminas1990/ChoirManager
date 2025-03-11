import assert from 'assert';
import TelegramBot from 'node-telegram-bot-api';

import { Logic } from './abstracts.js';
import { UserLogic } from './user.js';
import { BaseActivity } from '../activities/base_activity.js';
import { MainActivity } from '../activities/main.js';
import { BotAPI } from '../api/telegram.js';
import { Status, StatusWith } from '../../status.js';
import { GuestActivity } from '../activities/guest_activity.js';
import pino from 'pino';
import { return_exception, return_fail } from '../utils.js';

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

    static async Start(user: UserLogic, chat_id: number, parent_logger: pino.Logger)
    : Promise<StatusWith<Dialog>>
    {
        const logger = parent_logger.child({ "chat_id": chat_id });
        const dialog = new Dialog(user, chat_id, logger);
        const status = await dialog.start();
        if (!status.done()) {
            return status.wrap("failed to start dialog");
        }
        return StatusWith.ok().with(dialog);
    }

    private constructor(
        public readonly user: UserLogic,
        public readonly chat_id: number,
        private readonly logger: pino.Logger,
    ) {
        super(100);
        assert(chat_id);
        this.activity = user.is_guest()
            ? new GuestActivity(this, this.logger)
            : new MainActivity(this, this.logger);
    }

    private async start(): Promise<Status> {
        return await this.activity.start();
    }

    async proceed_impl(now: Date): Promise<Status> {
        if (this.activity != undefined) {
            this.activity.proceed(now);
            for (const input of this.input_queue) {
                if (input.what == "message") {
                    const status = await this.activity.on_message(input.message);
                    if (!status.done()) {
                        this.logger.error(status.what());
                    }
                } else if (input.what == "callback") {
                    const status = await this.activity.on_callback(input.callback);
                    if (!status.done()) {
                        this.logger.error(status.what());
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
            this.logger.info(`sending: ${msg}`);
            try {
                await BotAPI.instance().sendMessage(this.chat_id, msg);
                return Status.ok();
            } catch (error) {
                return return_exception(error, this.logger);
            }
        } else {
            return return_fail("Chat id is NOT set", this.logger);
        }
    }

    static pack(dialog: Dialog) {
        return [dialog.chat_id] as const;
    }

    static unpack(user: UserLogic, packed: ReturnType<typeof Dialog.pack>): StatusWith<Dialog> {
        const dialot_id = packed[0];
        const logger = user.get_logger().child({ chat_id: dialot_id });
        return StatusWith.ok().with(new Dialog(user, dialot_id, logger));
    }
}
