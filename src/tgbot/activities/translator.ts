import TelegramBot from "node-telegram-bot-api";
import { Status } from "../../status.js";
import { GoogleTranslate } from "../api/google_translate.js";
import { Runtime } from "../runtime.js";
import { Language } from "../database.js";
import pino from "pino";

// Not a ragular activity but a global activity, that is why it doesn't inherit
// from BaseActivity
export class AnnounceTranslator {
    constructor(private readonly logger: pino.Logger)
    {}

    async start(): Promise<Status> {
        return Status.ok();
    }

    async on_announce(msg: TelegramBot.Message): Promise<Status> {
        if (!msg.text) {
            return Status.ok();
        }

        const runtime = Runtime.get_instance();
        const users = [...runtime.all_users()].filter(logic => logic.data.lang !== Language.RU);
        if (users.length == 0) {
            return Status.ok();
        }

        const translated_text = await GoogleTranslate.translate(msg.text, "en");

        for (const user of users) {
            const dialog = user.main_dialog();
            if (!dialog) {
                continue;
            }
            const status = await dialog.send_message([
                `Announce by ${msg.from?.first_name} (@${msg.from?.username}):`,
                "",
                translated_text,
                "",
            ].join("\n"));
            if (!status.ok()) {
                this.logger.warn(`failed to send announce: ${status.what()}`);
            }
        }
        return Status.ok();
    }
}