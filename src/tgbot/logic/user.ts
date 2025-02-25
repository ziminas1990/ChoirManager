import TelegramBot from 'node-telegram-bot-api';
import { Logic } from './abstracts.js';
import { Dialog } from './dialog.js';
import { Database, Role, User } from '../database.js';
import { Status, StatusWith } from '../../status.js';
import { pack_map, unpack_map } from '../utils.js';

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
            dialog = new Dialog(this, chat_id);
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
        return [user.user.tgig, pack_map(user.dialogs, Dialog.pack)] as const;
    }

    static unpack(database: Database, packed: ReturnType<typeof UserLogic.pack>)
    : StatusWith<UserLogic> {
        const [tgig, dialogs] = packed;

        const user = database.get_user_by_tg_id(tgig);
        if (!user) {
            return StatusWith.fail(`User @${tgig} not found`);
        }
        const logic = new UserLogic(user);

        // Load dialogs
        const load_dialogs_problems: Status[] = [];
        logic.dialogs = unpack_map(dialogs, (packed) => {
            const status = Dialog.unpack(logic, packed);
            if (!status.ok()) {
                load_dialogs_problems.push(status);
            }
            return status.value!;
        });

        const status =
            load_dialogs_problems.length > 0 ?
            Status.warning("loading dialogs", load_dialogs_problems) :
            Status.ok();

        return status.with(logic);
    }
}
