import TelegramBot from "node-telegram-bot-api";
import { Dialog } from "../logic/dialog.js";
import { BaseActivity } from "./base_activity.js";
import { BotAPI } from "../api/telegram.js";
import { DownloadScoresActivity } from "./download_scores.js";
import { Status } from "../../status.js";
import { Language } from "../database.js";
import { seconds_since } from "../utils.js";
import { Action, ChoristerAssistant } from "../ai_assistants/chorister_assistant.js";

export class MainActivity extends BaseActivity {
    private last_welcome: Date = new Date(0);
    private child_activity?: BaseActivity;

    constructor(private dialog: Dialog)
    {
        super();
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

        // Check for service messages
        if (text.startsWith("/")) {
            return this.on_service_message(text);
        }

        const lang = this.dialog.user.data.lang;

        // First of all check if user hit any of the buttons
        if (text === Messages.again()) {
            this.start();
            return Status.ok();
        } else if (text === Messages.download_scores(lang)) {
            this.on_download_scores();
            return Status.ok();
        } else if (text == Messages.get_deposit_info(lang)) {
            return await this.on_deposit_request();
        }

        if (!msg.text) {
            return Status.ok();
        }

        return this.dialog_with_assistant(msg.text);
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
            Messages.greet(user_name, this.dialog.user.data.lang),
            {
                reply_markup: this.get_keyboard(),
            }
        );
        return Status.ok();
    }

    private async dialog_with_assistant(message: string): Promise<Status> {
        if (!ChoristerAssistant.is_available()) {
            return Status.ok();
        }

        const assistant = ChoristerAssistant.get_instance();
        const username = this.dialog.user.data.tgid;

        const send_status = await assistant.send_message(username, message);
        if (!send_status.ok()) {
            return Status.fail(`failed to send message: ${send_status.what()}`);
        }

        console.log(JSON.stringify(send_status.value, null, 2));

        for (const msg of send_status.value!) {
            if (msg.message) {
                BotAPI.instance().sendMessage(
                    this.dialog.chat_id,
                    msg.message!,
                    {
                        reply_markup: this.get_keyboard(),
                    }
                );
            }
            if (msg.actions && msg.actions.length > 0) {
                for (const action of msg.actions) {
                    const status = await this.on_action(action);
                    if (!status.ok()) {
                        return status;
                    }
                }
            }
        }
        return Status.ok();
    }

    private async on_action(action: Action): Promise<Status> {
        switch (action.what) {
            case "scores_list":
            case "download_scores":
                this.on_download_scores();
                return Status.ok();
            case "get_deposit_info":
                return await this.on_deposit_request();
            default:
                return Status.fail(`unknown action: ${action.what}`);
        }
    }

    private on_download_scores(): void {
        if (this.dialog.user.is_guest()) {
            return;
        }

        this.child_activity = new DownloadScoresActivity(this.dialog);
        this.child_activity.start();
    }

    private async on_deposit_request(): Promise<Status> {
        return await this.dialog.user.send_deposit_info();
    }

    private async on_service_message(command: string): Promise<Status> {
        if (command == "/backup") {
            return this.dialog.user.send_runtime_backup();
        }
        return Status.ok();
    }

    private get_keyboard(): TelegramBot.ReplyKeyboardMarkup {
        const lang = this.dialog.user.data.lang;
        return {
            keyboard: [
                [{ text: Messages.again() },
                 { text: Messages.download_scores(lang) },
                 { text: Messages.get_deposit_info(lang)}]
            ],
            is_persistent: true,
            resize_keyboard: true,
        }
    }
}

class Messages {

    static again(): string {
        return "🔄";
    }

    static download_scores(lang: Language): string {
        switch (lang) {
            case Language.RU: return "Скачать ноты";
            case Language.EN:
            default:
                return "Download scores";
        }
    }

    static get_deposit_info(lang: Language): string {
        switch (lang) {
            case Language.RU: return "Мой депозит";
            case Language.EN:
            default:
                return "My deposit";
        }
    }

    static greet(username: string, lang: Language): string {
        switch (lang) {
            case Language.RU: return [
                `Привет, ${username}!`,
                "Как я могу помочь?"
            ].join("\n");
            case Language.EN:
            default:
                return [
                    `Hello, ${username}!`,
                    "How can I help you?"
                ].join("\n");
        }
    }
}