import assert from 'assert';
import TelegramBot from 'node-telegram-bot-api';

import { Logic } from './abstracts.js';
import { UserLogic } from './user.js';
import { BaseActivity } from '../activities/base_activity.js';
import { MainActivity } from '../activities/main.js';
import { BotAPI } from '../api/telegram.js';
import { Status, StatusWith } from '../../status.js';
import { GuestActivity } from '../activities/guest_activity.js';
import { return_exception, return_fail } from '../utils.js';
import { Journal } from '../journal.js';
import { ChoristerAssistant } from '../ai_assistants/chorister_assistant.js';

type Input = {
    what: "message",
    message: TelegramBot.Message;
}

export class Dialog extends Logic<void> {

    private input_queue: Input[] = [];

    private journal: Journal;
    // activities stack
    private activity: BaseActivity;

    static async Start(user: UserLogic, chat_id: number, parent_journal: Journal)
    : Promise<StatusWith<Dialog>>
    {
        const dialog = new Dialog(user, chat_id, parent_journal);
        const status = await dialog.start();
        if (!status.done()) {
            return status.wrap("failed to start dialog");
        }
        return StatusWith.ok().with(dialog);
    }

    private constructor(
        public readonly user: UserLogic,
        public readonly chat_id: number,
        readonly parent_journal: Journal,
    ) {
        super(100);
        assert(chat_id);
        this.journal = parent_journal.child(`chat ${chat_id}`);
        this.activity = user.is_guest()
            ? new GuestActivity(this, this.journal)
            : new MainActivity(this, this.journal);
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
                        this.journal.log().error(status.what());
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

    async send_message(msg: string): Promise<Status> {
        if (this.chat_id) {
            this.journal.log().info(`sending: ${msg}`);
            try {
                await BotAPI.instance().sendMessage(this.chat_id, msg, { parse_mode: "HTML" });
                ChoristerAssistant.get_instance().add_response(this.user.data.tgid, msg);
                return Status.ok();
            } catch (error) {
                return return_exception(error, this.journal.log());
            }
        } else {
            return return_fail("Chat id is NOT set", this.journal.log());
        }
    }

    static pack(dialog: Dialog) {
        return [dialog.chat_id] as const;
    }

    static unpack(user: UserLogic, packed: ReturnType<typeof Dialog.pack>): StatusWith<Dialog> {
        const dialot_id = packed[0];
        return StatusWith.ok().with(new Dialog(user, dialot_id, user.get_journal()));
    }
}
