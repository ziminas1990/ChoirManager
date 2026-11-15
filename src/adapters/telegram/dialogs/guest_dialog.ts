import * as TelegramBot from "node-telegram-bot-api";

import { Expected, Status } from "@src/utils/expected.js";
import { IJournal } from "@src/interfaces/journal.js";
import { TelegramUser } from "@src/adapters/telegram/telegram_user.js";
import { seconds_since } from "@src/utils.js";
import { with_button_grid } from "@src/adapters/telegram/button_grid.js";


export class GuestDialog {
    private last_welcome: Date = new Date(0);
    private journal: IJournal;

    constructor(private user: TelegramUser, parent_journal: IJournal)
    {
        this.journal = parent_journal.child("guest_dialog");
    }

    async on_message(msg: TelegramBot.Message): Promise<Status> {
        this.journal.info(`message: ${msg.text}`);
        return await this.maybe_send_welcome();
    }

    private async maybe_send_welcome(): Promise<Status> {
        if (seconds_since(this.last_welcome) < 5) {
            return Expected.ok(undefined);
        }
        this.last_welcome = new Date();

        const text = [
            "Привет!",
            "Рады твоей заинтересованности нашим проектом!",
            "Если тебе хотелось бы присоединиться к нашему коллективу, заполни анкету" +
            " нового участника и мы тебе ответим в ближайшее время!"
        ];

        const status = await this.user.send_message(
            with_button_grid(text.join("<br>"), [
                [{ text: "Заполнить анкету", url: "https://forms.gle/zz1hbvCvFypLYupz5" }],
            ])
        );
        return status.as_status();
    }
}
