import TelegramBot from "node-telegram-bot-api";
import assert from "assert";

import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";
import { TelegramUser } from "@src/adapters/telegram/telegram_user.js";
import { ScoresActions } from "@src/use_cases/scores_actions.js";
import { DepositActions } from "@src/use_cases/deposit_actions.js";
import { CoreAPI } from "@src/use_cases/core.js";
import { AdminActions } from "@src/use_cases/admin_actions.js";
import { GlobalFormatter, return_fail, seconds_since, split_to_columns } from "@src/utils.js";
import { ChoristerAgent } from "@src/components/ai/agents/chorister_agent.js";
import { Language, Scores } from "@src/database.js";
import { AbstractWidget } from "@src/adapters/telegram/widgets/abstract.js";
import { FeedbackWidget } from "@src/adapters/telegram/widgets/feedback_activity.js";
import { Feedback } from "@src/entities/feedback.js";
import { IChorister, IUserAgent } from "@src/interfaces/user_agent.js";
import { ChoristerStatisticsWidget } from "@src/adapters/telegram/widgets/chorister_statistics.js";
import { register_user_assistant_tools } from "@src/components/ai/user_agent_tools_factory.js";
import { RuntimeConfig } from "@src/runtime.js";
import { AssistantConfig } from "@src/config.js";
import { TaskTrackerInstance } from "@src/interfaces/task_tracker.js";
import { SimpleMemoryInstance } from "@src/interfaces/simple_memory.js";


export class ChoristerDialog implements IChorister {
    private last_welcome: Date = new Date(0);
    private journal: Journal;

    private widgets: AbstractWidget[] = [];

    static create(
        user: TelegramUser,
        runtime_config: RuntimeConfig,
        parent_journal: Journal,
        assistant_config?: AssistantConfig,
    ): Expected<ChoristerDialog> {
        const journal = parent_journal.child("chorister_dialog");
        let dialog!: ChoristerDialog;

        let assistant: ChoristerAgent | undefined;
        if (assistant_config) {
            try {
                assistant = new ChoristerAgent(
                    assistant_config,
                    journal.child("assistant"),
                );
            } catch (e) {
                return Expected.exception("failed to create chorister assistant", e);
            }

            const tools_status = register_user_assistant_tools(
                assistant,
                user,
                user.info(),
                journal,
                {
                    send_message: async (message: string) => dialog.send_assistant_message(message),
                    start_feedback: async (details?: string) => dialog.start_feedback_activity(details),
                },
                {
                    task_tracker: TaskTrackerInstance.has_instance()
                        ? TaskTrackerInstance.get_instance()
                        : undefined,
                    simple_memory: SimpleMemoryInstance.get_instance(),
                },
            );
            if (!tools_status.ok) {
                return tools_status.wrap_error("failed to create assistant tools");
            }
        }

        dialog = new ChoristerDialog(user, runtime_config, journal, assistant);
        return Expected.ok(dialog);
    }

    constructor(
        private user: TelegramUser,
        private readonly runtime_config: RuntimeConfig,
        journal: Journal,
        private readonly assistant?: ChoristerAgent,
    )
    {
        this.journal = journal;
    }

    base(): IUserAgent {
        return this.user;
    }

    async on_message(msg: TelegramBot.Message): Promise<Status> {
        let text = msg.text;
        if (!text) {
            return Expected.ok(undefined);
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

        return await this.with_typing_indicator(
            async () => await this.dialog_with_assistant(text));
    }

    // From IChorister
    async send_scores_list(scores: Scores[]): Promise<Status> {
        this.journal.log().info("sending scores list");

        if (scores.length == 0) {
            this.user.send_message(this.no_scores_available(this.user.info().lang));
            return Expected.ok(undefined);
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

        return (await this.user.send_message(
            this.get_scores_list(this.user.info().lang),
            {
                reply_markup: keyboard,
            })).as_status();
    }

    // From IChorister
    async on_feedback_received(feedback: Feedback): Promise<Status> {
        this.journal.log().info({ feedback }, "feedback received");
        return (await this.user.send_message(
            Messages.feedback_received(feedback, this.user.info().lang))).as_status();
    }

    private async send_welcome(): Promise<Status> {
        if (seconds_since(this.last_welcome) < 5) {
            return Expected.ok(undefined);
        }
        this.last_welcome = new Date();

        const user_info = this.user.info();

        const sent = await this.user.send_message(
            Messages.greet(user_info.name, user_info.lang),
            {
                reply_markup: this.get_keyboard(),
            });
        return sent.as_status();
    }

    private async send_typing_indicator(): Promise<void> {
        const status = await this.user.send_chat_action("typing");
        if (!status.ok) {
            this.journal.log().warn(`Failed to send typing chat action: ${status.error}`);
        }
    }

    private async with_typing_indicator<T>(operation: () => Promise<T>): Promise<T> {

        const typing_interval = setInterval(() => {
            void this.send_typing_indicator();
        }, 3000);

        try {
            return await operation();
        } finally {
            clearInterval(typing_interval);
        }
    }

    private async send_assistant_message(message: string): Promise<Status> {
        const status = await this.user.send_message(message, {
            reply_markup: this.get_keyboard(),
        });
        return status.as_status();
    }

    private async dialog_with_assistant(message: string): Promise<Status> {
        if (!this.assistant) {
            return Expected.ok(undefined);
        }
        return this.assistant.send_message(message);
    }

    private async on_service_message(text: string): Promise<Status> {
        const command = text.split(/\s/)[0].split("@")[0];
        this.journal.log().info(`Processing service message: ${command}`);

        const user = CoreAPI.get_user_by_tg_id(this.user.userid(), false);
        if (!user || !user.value) {
            return Expected.err(`User ${this.user.userid()} not found`);
        }

        if (command == "/backup") {
            return AdminActions.send_runtime_backup(user.value, this.runtime_config, this.journal);
        } else if (command == "/get_logs") {
            return AdminActions.send_logs(user.value, this.runtime_config, this.journal);
        } else if (command == "/stop") {
            return AdminActions.stop_application(this.journal);
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
        if (!status.ok) {
            return status.wrap_error("failed to start feedback activity");
        }
        this.widgets.unshift(feedback_activity);
        return Expected.ok(undefined);
    }

    private async create_statistics_widget(): Promise<Status> {
        const statistics_widget = new ChoristerStatisticsWidget(this.user, this.journal);
        const status = await statistics_widget.start();
        if (!status.ok) {
            return status.wrap_error("failed to start statistics activity");
        }
        this.widgets.unshift(statistics_widget);
        return Expected.ok(undefined);
    }

    private async do_download_scores(score: Scores): Promise<Status> {
        this.journal.log().info(`downloading scores ${score.name}`);
        const status = await ScoresActions.download_scores_request(this.user, score, this.journal);
        if (!status.ok) {
            return (await this.user.send_message(this.fail_to_send_file(this.user.info().lang))).as_status();
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
