import TelegramBot from "node-telegram-bot-api";

import { Status } from "@src/status.js";
import { Journal } from "@src/journal.js";
import { TelegramUser } from "@src/adapters/telegram/telegram_user.js";
import { return_exception, seconds_since } from "@src/utils.js";


export class GuestDialog {
    private last_welcome: Date = new Date(0);
    private journal: Journal;

    constructor(private user: TelegramUser, parent_journal: Journal)
    {
        this.journal = parent_journal.child("guest_dialog");
    }

    async on_message(msg: TelegramBot.Message): Promise<Status> {
        this.journal.log().info(`message: ${msg.text}`);
        return await this.maybe_send_welcome();
    }

    private async maybe_send_welcome(): Promise<Status> {
        const keyboard: TelegramBot.InlineKeyboardMarkup = {
            inline_keyboard: [
                [{ text: "Заполнить анкету", url: "https://forms.gle/zz1hbvCvFypLYupz5" }]
            ]
        }

        if (seconds_since(this.last_welcome) < 5) {
            return Status.ok();
        }
        this.last_welcome = new Date();

        const text = [
            "Привет!",
            "Рады твоей заинтересованности нашим проектом!",
            "Если тебе хотелось бы присоединиться к нашему коллективу, заполни анкету" +
            " нового участника и мы тебе ответим в ближайшее время!"
        ];

        try {
            await this.user.send_message(
                text.join("\n"),
                {
                    reply_markup: keyboard,
                });
            return Status.ok();
        } catch (err) {
            return return_exception(err, this.journal.log());
        }
    }
}