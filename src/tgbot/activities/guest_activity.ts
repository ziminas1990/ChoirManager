import TelegramBot from "node-telegram-bot-api";
import { Journal } from "../journal.js";
import { Dialog } from "../logic/dialog.js";
import { BaseActivity } from "./base_activity.js";
import { BotAPI } from "../api/telegram.js";
import { Status } from "../../status.js";
import { return_exception, return_fail, seconds_since } from "../utils.js";

export class GuestActivity extends BaseActivity {
    private last_welcome: Date = new Date(0);
    private journal: Journal;

    constructor(private dialog: Dialog, parent_journal: Journal)
    {
        super();
        this.journal = parent_journal.child("guest");
    }

    async start(): Promise<Status> {
        this.maybe_send_welcome();
        return Status.ok();
    }

    async proceed(_: Date): Promise<Status> {
        return Status.ok();
    }

    async on_message(msg: TelegramBot.Message): Promise<Status> {
        this.journal.log().info(`message: ${msg.text}`);
        return await this.maybe_send_welcome();
    }

    async on_callback(query: TelegramBot.CallbackQuery): Promise<Status> {
        this.journal.log().info(`callback: ${query.data}`);
        return return_fail(`no child activity for callback: ${query.data}`, this.journal.log());
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
            await BotAPI.instance().sendMessage(
                this.dialog.chat_id,
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
