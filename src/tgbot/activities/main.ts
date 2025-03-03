import TelegramBot from "node-telegram-bot-api";
import { Dialog } from "../logic/dialog.js";
import { BaseActivity } from "./base_activity.js";
import { BotAPI } from "../api/telegram.js";
import { DownloadScoresActivity } from "./download_scores.js";
import { Status } from "../../status.js";
import { Language } from "../database.js";
import { seconds_since } from "../utils.js";

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
        const user = this.dialog.user;
        if (!user.is_guest()) {
            return await this.send_welcome();
        } else {
            return Status.fail(`User ${this.dialog.user.data.tgid} is a guest`);
        }
    }

    async proceed(now: Date): Promise<Status> {
        if (this.child_activity) {
            await this.child_activity.proceed(now);
        }
        return Status.ok();
    }

    async on_message(msg: TelegramBot.Message): Promise<Status> {
        const text = msg.text;
        if (!text) {
            return Status.ok();
        }

        // First of all check if user hit any of the buttons
        if (text === this.messages.again()) {
            this.start();
            return Status.ok();
        } else if (text === this.messages.download_scores()) {
            this.on_download_scores();
            return Status.ok();
        } else if (text == this.messages.get_deposit_info()) {
            return await this.on_deposit_request();
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

    private async on_deposit_request(): Promise<Status> {
        return await this.dialog.user.send_deposit_info()
    }

    private get_keyboard(): TelegramBot.ReplyKeyboardMarkup {
        const msg = this.messages;
        return {
            keyboard: [
                [{ text: msg.again() }, { text: msg.download_scores() }, { text: msg.get_deposit_info()}]
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
            case "ru": return "🔄";
            case "en":
            default:
                return "🔄";
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

    get_deposit_info(): string {
        switch (this.lang) {
            case "ru": return "Мой депозит";
            case "en":
            default:
                return "My deposit";
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