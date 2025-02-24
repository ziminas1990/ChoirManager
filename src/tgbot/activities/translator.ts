import TelegramBot from "node-telegram-bot-api";
import { User } from "../items/user.js";
import { Status } from "../../status.js";

// Not a ragular activity but a global activity, that is why it doesn't inherit
// from BaseActivity
export class TranslatorActivity {
    constructor(private users: Map<string, User>)
    {}

    start(): Status {
        return Status.ok();
    }

    on_announce(msg: TelegramBot.Message): void {
        if (!msg.text) {
            return;
        }

        for (const user of this.users.values()) {
            if (user.lang == "ru") {
                continue;
            }

            for (const dialog of user.all_dialogs()) {
                dialog.send_message([
                    `Announce by ${msg.from?.first_name} (@${msg.from?.username}):`,
                    "",
                    msg.text,
                    "",
                ].join("\n"));
            }
        }
    }
}
