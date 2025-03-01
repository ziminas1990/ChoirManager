import TelegramBot from 'node-telegram-bot-api';
import { Logic } from './abstracts.js';
import { Dialog } from './dialog.js';
import { Database, Role, User } from '../database.js';
import { Status, StatusWith } from '../../status.js';


export class UserLogic extends Logic {
    private dialog?: Dialog;

    private messages_queue: TelegramBot.Message[] = [];
    private last_activity?: Date;

    constructor(public readonly data: User) {
        super();
        this.last_activity = new Date();
    }

    is_guest(): boolean {
        return this.data.is(Role.Guest);
    }

    is_admin(): boolean {
        return this.data.is(Role.Admin);
    }

    main_dialog(): Dialog | undefined {
        return this.dialog;
    }

    on_message(msg: TelegramBot.Message): Status {
        this.last_activity = new Date();
        if (msg.chat.type !== "private") {
            return Status.fail("Message is not from a private chat");
        }
        this.messages_queue.push(msg);
        return Status.ok();
    }

    on_callback(query: TelegramBot.CallbackQuery): Status {
        this.last_activity = new Date();
        const chat_id = query.message?.chat.id;
        if (!chat_id) {
            return Status.fail("chat_id is undefined");
        }
        if (!this.dialog) {
            return Status.fail("dialog is undefined");
        }
        return this.dialog.on_callback(query);
    }

    get_last_activity() {
        return this.last_activity;
    }

    async proceed(now: Date): Promise<Status> {
        const status = await this.proceed_messages_queue();
        if (!status.ok()) {
            return status.wrap("can't proceed messages queue");
        }
        const proceed_status = this.dialog ? (await this.dialog.proceed(now)) : Status.ok();
        return proceed_status.wrap("dialog proceed");
    }

    static pack(user: UserLogic) {
        return [user.data.tgig, user.dialog ? Dialog.pack(user.dialog) : undefined] as const;
    }

    static unpack(database: Database, packed: ReturnType<typeof UserLogic.pack>)
    : StatusWith<UserLogic> {
        const [tgig, dialog] = packed;

        const user = tgig ? database.get_user_by_tg_id(tgig) : database.get_guest_user();
        if (!user) {
            return StatusWith.fail(`User @${tgig} not found`);
        }
        const logic = new UserLogic(user);

        // Load dialogs
        const unpack_dialog_status: StatusWith<Dialog> =
            dialog ? Dialog.unpack(logic, dialog) : Status.ok();
        if (unpack_dialog_status.ok()) {
            logic.dialog = unpack_dialog_status.value!;
        }

        return Status.ok_and_warnings("unpacking", [unpack_dialog_status]).with(logic);
    }

    private async proceed_messages_queue(): Promise<Status> {
        const warnings: Status[] = [];
        for (const msg of this.messages_queue) {
            const status = await this.proceed_message(msg);
            if (!status.ok()) {
                warnings.push(status);
            }
        }
        this.messages_queue = [];
        return Status.ok_and_warnings("proceed messages", warnings);
    }

    private async proceed_message(msg: TelegramBot.Message): Promise<Status> {
        const is_start = msg.text?.toLocaleLowerCase() === "/start";

        if (!this.dialog || this.dialog.chat_id !== msg.chat.id || is_start) {
            this.dialog = undefined;
            const status = await Dialog.Start(this, msg.chat.id);
            if (!status.ok()) {
                return status.wrap("can't start dialog");
            }
            this.dialog = status.value!;
        }

        return this.dialog.on_message(msg);
    }
}
