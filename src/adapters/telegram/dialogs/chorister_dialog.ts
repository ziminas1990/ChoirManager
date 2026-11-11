import TelegramBot from "node-telegram-bot-api";
import assert from "assert";

import { IJournal } from "@src/interfaces/journal.js";
import { Expected, Status } from "@src/utils/expected.js";
import { TelegramUser } from "@src/adapters/telegram/telegram_user.js";
import { ScoresActions } from "@src/use_cases/scores_actions.js";
import { DepositActions } from "@src/use_cases/deposit_actions.js";
import { AdminActions } from "@src/use_cases/admin_actions.js";
import { GlobalFormatter, return_fail, seconds_since, split_to_columns } from "@src/utils.js";
import { ChoristerAgent } from "@src/components/ai/agents/chorister_agent.js";
import { Score } from "@src/entities/score.js";
import { Language, Role } from "@src/entities/user.js";
import { AbstractWidget } from "@src/adapters/telegram/widgets/abstract.js";
import { FeedbackWidget } from "@src/adapters/telegram/widgets/feedback_activity.js";
import { Feedback } from "@src/entities/feedback.js";
import { IChorister, IUserAgent } from "@src/interfaces/user_agent.js";
import { ChoristerStatisticsWidget } from "@src/adapters/telegram/widgets/chorister_statistics.js";
import { ChoristerToolsManager } from "@src/components/ai/chorister_tools_manager.js";
import { RuntimeConfig } from "@src/runtime.js";
import { AssistantConfig } from "@src/config.js";
import { IUserServiceReplica } from "@src/interfaces/user_service.js";
import { Environment } from "@src/components/environment.js";
import { ScoreDownloads } from "@src/adapters/telegram/score_downloads.js";


export class ChoristerDialog implements IChorister {
    private last_welcome: Date = new Date(0);
    private journal: IJournal;

    private widgets: AbstractWidget[] = [];

    constructor(
        private user: TelegramUser,
        private readonly runtime_config: RuntimeConfig,
        journal: IJournal,
        private readonly assistant: ChoristerAgent,
        private readonly tools_manager: ChoristerToolsManager,
    )
    {
        this.journal = journal;
    }

    static create(
        user: TelegramUser,
        runtime_config: RuntimeConfig,
        users: IUserServiceReplica,
        parent_journal: IJournal,
        assistant_config: AssistantConfig,
    ): Expected<ChoristerDialog> {
        const journal = parent_journal.child("chorister_dialog");
        let dialog!: ChoristerDialog;

        const tools = ChoristerToolsManager.create(
            user,
            user.info().roles,
            journal,
            {
                send_message: async (message: string) => dialog.send_assistant_message(message),
                start_feedback: async (details?: string) => dialog.start_feedback_activity(details),
            },
            {
                task_tracker: Environment.global.maybe_task_tracker_service,
                simple_memory: Environment.global.maybe_simple_memory_service,
                users,
                administration: Environment.global.maybe_administration_service,
            },
        );
        if (!tools.ok) {
            return tools.wrap_error("failed to create assistant tools");
        }

        let assistant: ChoristerAgent;
        try {
            assistant = new ChoristerAgent(
                assistant_config,
                tools.value.get_toolchain(),
                journal.child("assistant"),
            );
        } catch (e) {
            return Expected.exception("failed to create chorister assistant", e);
        }

        dialog = new ChoristerDialog(user, runtime_config, journal, assistant, tools.value);
        return Expected.ok(dialog);
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
            async () => await this.assistant.send_message(text));
    }

    // From IChorister
    async send_scores_list(scores: Score[]): Promise<Status> {
        this.journal.info("sending scores list");

        if (scores.length == 0) {
            this.user.send_message(this.no_scores_available(this.user.info().lang));
            return Expected.ok(undefined);
        }

        // send only scores with files
        scores = scores.filter(score => score.file);

        const buttons = scores.map(score => ScoreDownloads.create_button(score));

        const keyboard: TelegramBot.InlineKeyboardMarkup = {
            inline_keyboard: split_to_columns(buttons, 2)
        };

        return (await this.user.send_message(
            this.get_scores_list(this.user.info().lang),
            {
                reply_markup: keyboard,
            })).as_status();
    }

    update_roles(roles: readonly Role[]): Status {
        return this.tools_manager.update_roles(roles);
    }

    // From IChorister
    async on_feedback_received(feedback: Feedback): Promise<Status> {
        this.journal.info({ feedback }, "feedback received");
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
            this.journal.warning(`Failed to send typing chat action: ${status.error}`);
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

    private async on_service_message(text: string): Promise<Status> {
        const command = text.split(/\s/)[0].split("@")[0];
        this.journal.info(`Processing service message: ${command}`);

        const user = this.user.info();

        if (command == "/backup") {
            return AdminActions.send_runtime_backup(user, this.runtime_config, this.journal);
        } else if (command == "/get_logs") {
            return AdminActions.send_logs(user, this.runtime_config, this.journal);
        } else if (command == "/stop") {
            return AdminActions.stop_application(this.journal);
        } else {
            return return_fail(`unknown service command: ${command}`, this.journal);
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
        return Expected.ok(undefined);
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

