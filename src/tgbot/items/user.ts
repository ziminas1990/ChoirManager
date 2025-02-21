import TelegramBot from 'node-telegram-bot-api';
import { Proceedable } from './abstracts.js';
import { Dialog } from './dialog.js';

export class User extends Proceedable {
    private dialogs: Map<number, Dialog> = new Map();

    constructor(
        public readonly id: number,
        public readonly name: string,
        public readonly surname: string,
        public readonly roles: string[],
        public readonly tgig: string)
    {
        super();
    }


    is_guest(): boolean {
        return this.id == 0;
    }

    on_message(msg: TelegramBot.Message): void {
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

    static pack(user: User) {
        return [user.id, user.name, user.surname, user.roles, user.tgig] as const;
    }

    static unpack(packed: ReturnType<typeof User.pack>): User {
        return new User(packed[0], packed[1], packed[2], packed[3], packed[4]);
    }
}
