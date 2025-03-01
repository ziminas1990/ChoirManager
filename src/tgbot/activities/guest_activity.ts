import TelegramBot from "node-telegram-bot-api";
import { Dialog } from "../logic/dialog.js";
import { BaseActivity } from "./base_activity.js";
import { BotAPI } from "../api/telegram.js";
import { Status } from "../../status.js";
import { seconds_since } from "../utils.js";

export class GuestActivity extends BaseActivity {
    private last_welcome: Date = new Date(0);

    constructor(private dialog: Dialog)
    {
        super();
    }

    async start(): Promise<Status> {
        this.maybe_send_welcome();
        return Status.ok();
    }

    async proceed(_: Date): Promise<Status> {
        return Status.ok();
    }

    async on_message(msg: TelegramBot.Message): Promise<Status> {
        this.maybe_send_welcome();
        return Status.fail(`unexpected message: "${msg.text}"`);
    }

    async on_callback(query: TelegramBot.CallbackQuery): Promise<Status> {
        return Status.fail(`no child activity for callback: ${query.data}`);
    }

    private maybe_send_welcome(): void {
        const keyboard: TelegramBot.InlineKeyboardMarkup = {
            inline_keyboard: [
                [{ text: "Заполнить анкету", url: "https://forms.gle/zz1hbvCvFypLYupz5" }]
            ]
        }

        if (seconds_since(this.last_welcome) < 5) {
            return;
        }
        this.last_welcome = new Date();

        const text = [
            "Привет!",
            "Рады твоей заинтересованности нашим проектом!",
            "Если тебе хотелось бы присоединиться к нашему коллективу, заполни анкету" +
            " нового участника и мы тебе ответим в ближайшее время!"
        ];

        BotAPI.instance().sendMessage(
            this.dialog.chat_id,
            text.join("\n"),
            {
                reply_markup: keyboard,
            }
        );
    }
}
