import TelegramBot from "node-telegram-bot-api";
import { Dialog } from "../logic/dialog.js";
import { BaseActivity } from "./base_activity.js";
import { BotAPI } from "../api/telegram.js";
import { DownloadScoresActivity } from "./download_scores.js";
import { Status } from "../../status.js";
import { Language } from "../database.js";

function seconds_since(date: Date): number {
    return (new Date().getTime() - date.getTime()) / 1000;
}

export class MainActivity extends BaseActivity {
    private messages: Messages;
    private last_welcome: Date = new Date(0);
    private child_activity?: BaseActivity;

    constructor(private dialog: Dialog)
    {
        super();
        this.messages = new Messages(dialog.user.data.lang);
    }

    async start(): Promise<Status> {
        if (!this.dialog.user.is_guest()) {
            return await this.send_welcome();
        } else {
            return await this.send_welcome_to_guest();
        }
    }

    async proceed(now: Date): Promise<Status> {
        if (this.child_activity) {
            await this.child_activity.proceed(now);
        }
        return Status.ok();
    }

    async on_message(msg: TelegramBot.Message): Promise<Status> {
        // First of all check if user hit any of the buttons
        if (msg.text?.toLocaleLowerCase() === this.messages.again().toLocaleLowerCase()) {
            this.start();
            return Status.ok();
        } else if (msg.text?.toLocaleLowerCase() === this.messages.download_scores().toLocaleLowerCase()) {
            this.on_download_scores();
            return Status.ok();
        }

        if (this.child_activity && !this.child_activity.done()) {
            this.child_activity.on_message(msg);
            return Status.ok();
        }

        return Status.fail(`unexpected message: "${msg.text}"`);
    }

    async on_callback(query: TelegramBot.CallbackQuery): Promise<Status> {
        if (this.child_activity) {
            this.child_activity.on_callback(query);
            return Status.ok();
        }
        return Status.fail(`no child activity for callback: ${query.data}`);
    }

    private async send_welcome_to_guest(): Promise<Status> {
        const keyboard: TelegramBot.InlineKeyboardMarkup = {
            inline_keyboard: [
                [{ text: "Заполнить анкету", url: "https://forms.gle/zz1hbvCvFypLYupz5" }]
            ]
        }

        if (seconds_since(this.last_welcome) < 5) {
            return Status.ok();  // not a problem
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
        return Status.ok();
    }

    private async send_welcome(): Promise<Status> {
        const user_name = this.dialog.user!.data.name;

        if (seconds_since(this.last_welcome) < 5) {
            return Status.ok();
        }
        this.last_welcome = new Date();

        BotAPI.instance().sendMessage(
            this.dialog.chat_id,
            this.messages.greet(user_name),
            {
                reply_markup: this.get_keyboard(),
            }
        );
        return Status.ok();
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
                [{ text: this.messages.again() }, { text: this.messages.download_scores() }]
            ],
            is_persistent: true,
            resize_keyboard: true,
        }
    }
}

class Messages {
    constructor(private lang: Language)
    {}

    again(): string {
        switch (this.lang) {
            case "ru": return "Заново";
            case "en":
            default:
                return "Restart";
        }
    }

    download_scores(): string {
        switch (this.lang) {
            case "ru": return "Скачать ноты";
            case "en":
            default:
                return "Download scores";
        }
    }

    greet(username: string): string {
        switch (this.lang) {
            case "ru": return [
                `Привет, ${username}!`,
                "Как я могу помочь?"
            ].join("\n");
            case "en":
            default:
                return [
                    `Hello, ${username}!`,
                    "How can I help you?"
                ].join("\n");
        }
    }
}