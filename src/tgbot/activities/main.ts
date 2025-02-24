import TelegramBot from "node-telegram-bot-api";
import { Dialog } from "../logic/dialog.js";
import { BaseActivity } from "./base_activity.js";
import { BotAPI } from "../api/telegram.js";
import { DownloadScoresActivity } from "./download_scores.js";
import { Status } from "../../status.js";

function seconds_since(date: Date): number {
    return (new Date().getTime() - date.getTime()) / 1000;
}

export class MainActivity extends BaseActivity {

    private last_welcome: Date = new Date(0);

    private child_activity?: BaseActivity;

    constructor(dialog: Dialog)
    {
        super(dialog);
    }

    start(): void {
        if (!this.dialog.user.is_guest()) {
            this.send_welcome();
        } else {
            this.send_welcome_to_guest();
        }
    }

    on_message(msg: TelegramBot.Message): Status {
        // First of all check if user hit any of the buttons
        if (msg.text?.toLocaleLowerCase() === "заново") {
            this.start();
            return Status.ok();
        } else if (msg.text?.toLocaleLowerCase() === "скачать ноты") {
            this.on_download_scores();
            return Status.ok();
        }

        if (this.child_activity && !this.child_activity.done()) {
            this.child_activity.on_message(msg);
            return Status.ok();
        }

        return Status.fail(`unexpected message: "${msg.text}"`);
    }

    on_callback(query: TelegramBot.CallbackQuery): Status {
        if (this.child_activity) {
            this.child_activity.on_callback(query);
            return Status.ok();
        }
        return Status.fail(`no child activity for callback: ${query.data}`);
    }

    private send_welcome_to_guest(): void {
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

    private send_welcome(): void {
        const user_name = this.dialog.user!.user.name;

        if (seconds_since(this.last_welcome) < 5) {
            return;
        }
        this.last_welcome = new Date();

        const text = [
            `Рад видеть тебя, ${user_name}!`,
            "Как я могу помочь?"
        ];

        BotAPI.instance().sendMessage(
            this.dialog.chat_id,
            text.join("\n"),
            {
                reply_markup: this.get_keyboard(),
            }
        );
    }

    private on_download_scores(): void {
        if (this.dialog.user.is_guest()) {
            return;
        }

        this.child_activity = new DownloadScoresActivity(this.dialog);
        this.child_activity.start();
    }

    private get_keyboard(): TelegramBot.ReplyKeyboardMarkup {
        return {
            keyboard: [
                [{ text: 'Заново' }, { text: 'Скачать ноты' }]
            ],
            is_persistent: true,
            resize_keyboard: true,
        }
    }
}
