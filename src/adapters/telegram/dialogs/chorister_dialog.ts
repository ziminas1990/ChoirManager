import TelegramBot from "node-telegram-bot-api";
import assert from "assert";

import { Journal } from "@src/journal.js";
import { Status } from "@src/status.js";
import { TelegramUser } from "@src/adapters/telegram/telegram_user.js";
import { ScoresActions } from "@src/use_cases/scores_actions.js";
import { DepositActions } from "@src/use_cases/deposit_actions.js";
import { CoreAPI } from "@src/use_cases/core.js";
import { AdminActions } from "@src/use_cases/admin_actions.js";
import { GlobalFormatter, return_exception, return_fail, seconds_since, split_to_columns } from "@src/utils.js";
import { ChoristerAssistant, Response } from "@src/ai_assistants/chorister_assistant.js";
import { Language, Scores } from "@src/database.js";
import { AbstractWidget } from "@src/adapters/telegram/widgets/abstract.js";
import { FeedbackWidget } from "@src/adapters/telegram/widgets/feedback_activity.js";
import { Feedback } from "@src/entities/feedback.js";
import { IChorister, IUserAgent } from "@src/interfaces/user_agent.js";
import { ChoristerStatisticsWidget } from "../widgets/chorister_statistics";


export class ChoristerDialog implements IChorister {
    private last_welcome: Date = new Date(0);
    private journal: Journal;

    private widgets: AbstractWidget[] = [];

    constructor(private user: TelegramUser, parent_journal: Journal)
    {
        this.journal = parent_journal.child("chorister_dialog");
    }

    base(): IUserAgent {
        return this.user;
    }

    async on_message(msg: TelegramBot.Message): Promise<Status> {
        let text = msg.text;
        if (!text) {
            return Status.ok();
        }
        if (text == "/start") {
            text = Messages.again();
        }

        // Check for service messages
        if (text.startsWith("/")) {
            return this.on_service_message(text);
        }

        const lang = this.user.info().lang;

        // First of all check if user hit any of the buttons
        if (text === Messages.again()) {
            for (const widget of this.widgets) {
                await widget.interrupt();
            }
            this.widgets = [];
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
        } else if (text == Messages.feedback_button(lang)) {
            return await this.start_feedback_activity();
        } else if (text == Messages.statistics_button(lang)) {
            return await this.create_statistics_widget();
        } else if (this.widgets.length > 0) {
            const waiting_widgets = this.widgets.filter(widget => widget.waits_for_message());
            // Only the most recent widget should receive a message
            const first = waiting_widgets.shift();
            // All other widgets that were waiting for message should be interrupted
            for (const widget of waiting_widgets) {
                await widget.interrupt();
                assert(widget.finished());
            }
            // Remove all finished widgets
            this.widgets = this.widgets.filter(widget => !widget.finished());
            // Pass the message finaly
            if (first) {
                return await first.consume_message(msg);
            }
        }

        if (!msg.text) {
            return Status.ok();
        }

        return (await this.dialog_with_assistant(msg.text)).wrap("assistant failure");
    }

    // From IChorister
    async send_scores_list(scores: Scores[]): Promise<Status> {
        this.journal.log().info("sending scores list");

        if (scores.length == 0) {
            this.user.send_message(this.no_scores_available(this.user.info().lang));
            return Status.ok();
        }

        // send only scores with files
        scores = scores.filter(score => score.file);

        const buttons = scores.map(score => {
            return this.user.create_keyboard_button(
                score.name,
                `download ${score.name} scores`,
                () => this.do_download_scores(score),
                3600
            );
        });

        const keyboard: TelegramBot.InlineKeyboardMarkup = {
            inline_keyboard: split_to_columns(buttons, 2)
        };

        try {
            return this.user.send_message(
                this.get_scores_list(this.user.info().lang),
                {
                    reply_markup: keyboard,
                });
        } catch (err) {
            return return_exception(err, this.journal.log());
        }
    }

    // From IChorister
    async on_feedback_received(feedback: Feedback): Promise<Status> {
        this.journal.log().info({ feedback }, "feedback received");
        return this.user.send_message(
            Messages.feedback_received(feedback, this.user.info().lang));
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
            case "feedback":
                return await this.start_feedback_activity(action.details);
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

    private async start_feedback_activity(details?: string): Promise<Status> {
        const feedback_activity = new FeedbackWidget(this.user, this.journal);
        if (details) {
            feedback_activity.on_details_provided(details);
        }
        const status = await feedback_activity.start();
        if (!status.ok()) {
            return status.wrap("failed to start feedback activity");
        }
        this.widgets.unshift(feedback_activity);
        return Status.ok();
    }

    private async create_statistics_widget(): Promise<Status> {
        const statistics_widget = new ChoristerStatisticsWidget(this.user, this.journal);
        const status = await statistics_widget.start();
        if (!status.ok()) {
            return status.wrap("failed to start statistics activity");
        }
        this.widgets.unshift(statistics_widget);
        return Status.ok();
    }

    private async do_download_scores(score: Scores): Promise<Status> {
        this.journal.log().info(`downloading scores ${score.name}`);
        const status = await ScoresActions.download_scores_request(this.user, score, this.journal);
        if (!status.ok()) {
            return this.user.send_message(this.fail_to_send_file(this.user.info().lang));
        }
        return status;
    }

    private get_scores_list(lang: Language): string {
        switch (lang) {
            case Language.RU: return "Какие ноты тебе нужны?";
            case Language.EN:
            default:
                return "Which scores do you need?";
        }
    }

    private no_scores_available(lang: Language): string {
        switch (lang) {
            case Language.RU: return "Нет доступных файлов";
            case Language.EN:
            default:
                return "No available scores";
        }
    }

    private fail_to_send_file(lang: Language): string {
        switch (lang) {
            case Language.RU: return "Сори, что-то пошло не так...";
            case Language.EN:
            default:
                return "Sorry, something went wrong...";
        }
    }

    private get_keyboard(): TelegramBot.ReplyKeyboardMarkup {
        const lang = this.user.info().lang;
        return {
            keyboard: [
                [{ text: Messages.again() },
                 { text: Messages.get_deposit_info(lang)},
                 { text: Messages.statistics_button(lang)}],
                [{ text: Messages.feedback_button(lang)},
                 { text: Messages.download_scores(lang)}]
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

    static feedback_button(lang: Language): string {
        switch (lang) {
            case Language.RU: return "Обратная связь";
            case Language.EN:
            default:
                return "Leave a feedback";
        }
    }

    static statistics_button(lang: Language): string {
        switch (lang) {
            case Language.RU: return "Статистика";
            case Language.EN:
            default:
                return "Statistics";
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

    static feedback_received(feedback: Feedback, lang: Language): string {
        const parts = (() => {
            switch (lang) {
                case Language.RU:
                    return {
                        header: "Спасибо за обратную связь!",
                        anonymous: "Фидбек отправлен анонимно",
                        from_author: "Отправлен от твоего имени",
                        from_voice: "Отправлен от лица твоей партии",
                    }
                case Language.EN:
                default:
                    return {
                        header: "Thank you for your feedback!",
                        anonymous: "Feedback sent anonymously",
                        from_author: "Sent from your name",
                        from_voice: "Sent from your voice",
                    }
            }
        })();

        const message: string[] = [
            parts.header,
            "",
            GlobalFormatter.instance().quote(feedback.details),
            "",
        ];

        if (feedback.who) {
            message.push([
                GlobalFormatter.instance().bold("Author:"),
                `${feedback.who.name_surname} (@${feedback.who.tgid})`
            ].join(" "));
        }
        if (feedback.voice) {
            message.push([
                GlobalFormatter.instance().bold("Voice:"),
                feedback.voice
            ].join(" "));
        }
        if (!feedback.who && !feedback.voice) {
            message.push(GlobalFormatter.instance().italic("(anonymous feedback)"));
        }

        return message.join("\n");
    }
}
