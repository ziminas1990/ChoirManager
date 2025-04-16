import TelegramBot from "node-telegram-bot-api";

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
import { AbstractActivity } from "@src/adapters/telegram/widgets/abstract.js";
import { FeedbackWidget } from "@src/adapters/telegram/widgets/feedback_activity.js";
import { Feedback } from "@src/entities/feedback.js";
import { IChorister, IUserAgent } from "@src/interfaces/user_agent.js";
import { ChoristerStatistics } from "@src/entities/statistics.js";
import { Analytic } from "@src/use_cases/analytic";


export class ChoristerDialog implements IChorister {
    private last_welcome: Date = new Date(0);
    private journal: Journal;

    private current_activity?: AbstractActivity;

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
            if (this.current_activity) {
                await this.current_activity.interrupt();
                this.current_activity = undefined;
            }
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
            return await Analytic.chorister_statistic_request(this.user, 30);
        } else if (this.current_activity) {
            // Check if any activity is running and waits for message
            if (this.current_activity.finished()) {
                this.current_activity = undefined;
            } else if (this.current_activity.waits_for_message()) {
                return await this.current_activity.consume_message(msg);
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

    // From IChorister
    async send_statistics(statistics: ChoristerStatistics): Promise<Status> {
        return this.user.send_message(
            Messages.statistics(statistics, this.user.info().lang));
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
        if (this.current_activity) {
            await this.current_activity.interrupt();
        }
        const feedback_activity = new FeedbackWidget(this.user, this.journal);
        if (details) {
            feedback_activity.on_details_provided(details);
        }
        const status = await feedback_activity.start();
        if (!status.ok()) {
            return status.wrap("failed to start feedback activity");
        }
        this.current_activity = feedback_activity;
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

    static statistics(statistics: ChoristerStatistics, lang: Language): string {
        const parts = (() => {
            switch (lang) {
                case Language.RU:
                    return {
                        header: "Твоя статистика посещений за последние",
                        days: "дней",
                        rehersals_status: "Ты посетил(а) {visited_rehersals} из {total_rehersals} репетиций",
                        hours_status: "Ты репетировал(а) {visited_hours} часов из {total_hours} часов",
                        attendance: "Твоя посещаемость",
                    }
                case Language.EN:
                default:
                    return {
                        header: "Your statistics for the last",
                        days: "days",
                        rehersals_status: "You visited {visited_rehersals} out of {total_rehersals} rehearsals",
                        hours_status: "You spent {visited_hours} hours out of {total_hours} hours",
                        attendance: "Your attendance",
                    }
            }
        })();

        const formatter = GlobalFormatter.instance();

        const attendance = statistics.visited_hours / statistics.total_hours * 100;
        const diff_ms = statistics.period.to.getTime() - statistics.period.from.getTime();
        const days = Math.ceil(diff_ms / (1000 * 60 * 60 * 24));

        const rehersals_stat = parts.rehersals_status
            .replace("{visited_rehersals}", statistics.visited_rehersals.toFixed(0))
            .replace("{total_rehersals}", statistics.total_rehersals.toFixed(0));

        const hours_stat = parts.hours_status
            .replace("{visited_hours}", statistics.visited_hours.toFixed(0))
            .replace("{total_hours}", statistics.total_hours.toFixed(0));

        return [
            formatter.bold(`${parts.header} ${days} ${parts.days}:`),
            rehersals_stat,
            hours_stat,
            `${parts.attendance}: ${attendance.toFixed(0)}%`,
        ].join("\n");
    }
}
