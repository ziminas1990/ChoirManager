import TelegramBot from "node-telegram-bot-api";

import { Journal } from "@src/journal.js";
import { Status } from "@src/status.js";
import { TelegramUser } from "@src/adapters/telegram/telegram_user.js";
import { ScoresActions } from "@src/use_cases/scores_actions.js";
import { DepositActions } from "@src/use_cases/deposit_actions.js";
import { CoreAPI } from "@src/use_cases/core.js";
import { AdminActions } from "@src/use_cases/admin_actions.js";
import { return_exception, return_fail, seconds_since } from "@src/utils.js";
import { ChoristerAssistant, Response } from "@src/ai_assistants/chorister_assistant.js";
import { Language } from "@src/database.js";


export class ChoristerDialog {
    private last_welcome: Date = new Date(0);
    private journal: Journal;

    constructor(private user: TelegramUser, parent_journal: Journal)
    {
        this.journal = parent_journal.child("chorister_dialog");
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

        const lang = this.user.info().lang;

        // First of all check if user hit any of the buttons
        if (text === Messages.again()) {
            return await this.send_welcome();
        } else if (text === Messages.download_scores(lang)) {
            return await ScoresActions.scores_list_requested(
                this.user,
                this.journal
            );
        } else if (text == Messages.get_deposit_info(lang)) {
            return await DepositActions.deposit_requested(
                this.user,
                this.journal
            );
        }

        if (!msg.text) {
            return Status.ok();
        }

        return (await this.dialog_with_assistant(msg.text)).wrap("assistant failure");
    }

    private async send_welcome(): Promise<Status> {
        if (seconds_since(this.last_welcome) < 5) {
            return Status.ok();
        }
        this.last_welcome = new Date();

        const user_info = this.user.info();

        try {
            await this.user.send_message(
                Messages.greet(user_info.name, user_info.lang),
                {
                    reply_markup: this.get_keyboard(),
                });
            return Status.ok();
        } catch (err) {
            return return_exception(err, this.journal.log());
        }
    }

    private async dialog_with_assistant(message: string): Promise<Status> {
        if (!ChoristerAssistant.is_available()) {
            return Status.ok();
        }

        const assistant = ChoristerAssistant.get_instance();
        const username = this.user.info().tgid;

        const send_status = await assistant.send_message(username, message);
        if (!send_status.ok()) {
            return send_status.wrap(`assistant failure`);
        }

        this.journal.log().info({ response: send_status.value }, `assistant response`);

        for (const response of send_status.value!) {
            const status = await this.on_action(response);
            if (!status.ok()) {
                return status.wrap(`action ${response.what} failed`);
            }
        }
        return Status.ok();
    }

    private async on_action(action: Response): Promise<Status> {
        switch (action.what) {
            case "message":
                try {
                    await this.user.send_message(
                        action.text,
                        {
                            reply_markup: this.get_keyboard(),
                        });
                } catch (err) {
                    return Status.exception(err).wrap(`failed to send assistant response`);
                }
                return Status.ok();
            case "scores_list":
                return await ScoresActions.scores_list_requested(this.user, this.journal);
            case "download_scores":
                return await ScoresActions.download_scores_request(
                    this.user, action.filename, this.journal);
            case "get_deposit_info":
                return await DepositActions.deposit_requested(this.user, this.journal);
            case "already_paid":
                return DepositActions.already_paid(this.user, this.journal);
            case "top_up":
                return DepositActions.top_up(
                    this.user, action.amount, action.original_message, this.journal);
            default:
                return return_fail(`unknown action: ${JSON.stringify(action)}`, this.journal.log());
        }
    }

    private async on_service_message(command: string): Promise<Status> {
        this.journal.log().info(`Processing service message: ${command}`);

        const user = CoreAPI.get_user_by_tg_id(this.user.userid());
        if (!user || !user.value) {
            return Status.fail(`User ${this.user.userid()} not found`);
        }

        if (command == "/backup") {
            return AdminActions.send_runtime_backup(user.value, this.journal);
        } else if (command == "/get_logs") {
            return AdminActions.send_logs(user.value, this.journal);
        } else {
            return return_fail(`unknown service command: ${command}`, this.journal.log());
        }
    }

    private get_keyboard(): TelegramBot.ReplyKeyboardMarkup {
        const lang = this.user.info().lang;
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