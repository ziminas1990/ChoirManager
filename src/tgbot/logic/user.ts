import TelegramBot from 'node-telegram-bot-api';
import { Logic } from './abstracts.js';
import { Dialog } from './dialog.js';
import { Role, User } from '../database.js';
import { Status } from '../../status.js';

export class UserLogic extends Logic {
    private dialogs: Map<number, Dialog> = new Map();

    constructor(public readonly user: User) {
        super();
    }

    is_guest(): boolean {
        return this.user.is(Role.Guest);
    }

    all_dialogs(): Dialog[] {
        return Array.from(this.dialogs.values());
    }

    on_message(msg: TelegramBot.Message): Status {
        if (msg.chat.type !== "private") {
            return Status.fail("Message is not from a private chat");
        }

        const chat_id = msg.chat.id;
        let dialog = this.dialogs.get(chat_id);

        const is_start = msg.text?.toLocaleLowerCase() === "/start";

        if (dialog && is_start) {
            this.dialogs.delete(chat_id);
            dialog = undefined;
        }

        if (dialog == undefined) {
            dialog = new Dialog(chat_id, this);
            this.dialogs.set(chat_id, dialog);
            dialog.start();
        }

        if (!is_start) {
            dialog.on_message(msg);
        }
        return Status.ok();
    }

    on_callback(query: TelegramBot.CallbackQuery): void {
        const chat_id = query.message?.chat.id;
        if (!chat_id) return;

        const dialog = this.dialogs.get(chat_id);
        if (dialog == undefined) {
            return;
        }
        dialog.on_callback(query);
    }

    proceed(now: Date): void {
        for (const dialog of this.dialogs.values()) {
            dialog.proceed(now);
        }
    }

    static pack(user: UserLogic) {
        return [User.pack(user.user)] as const;
    }

    static unpack(packed: ReturnType<typeof UserLogic.pack>): UserLogic {
        return new UserLogic(User.unpack(packed[0]));
    }
}
