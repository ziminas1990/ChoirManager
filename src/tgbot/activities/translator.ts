import TelegramBot from "node-telegram-bot-api";
import { Status } from "../../status.js";
import { GoogleTranslate } from "../api/google_translate.js";
import { Runtime } from "../runtime.js";

// Not a ragular activity but a global activity, that is why it doesn't inherit
// from BaseActivity
export class AnnounceTranslator {
    constructor(private runtime: Runtime)
    {}

    start(): Status {
        return Status.ok();
    }

    async on_announce(msg: TelegramBot.Message): Promise<Status> {
        if (!msg.text) {
            return Status.ok();
        }

        const users = [...this.runtime.all_users()].filter(logic => logic.data.lang !== "ru");
        if (users.length == 0) {
            return Status.ok();
        }

        const translated_text = await GoogleTranslate.translate(msg.text, "en");

        for (const user of users) {
            for (const dialog of user.all_dialogs()) {
                dialog.send_message([
                    `Announce by ${msg.from?.first_name} (@${msg.from?.username}):`,
                    "",
                    translated_text,
                    "",
                ].join("\n"));
            }
        }
        return Status.ok();
    }
}