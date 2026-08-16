import TelegramBot from "node-telegram-bot-api";

import { Journal } from "@src/journal.js";
import { TelegramUser } from "@src/adapters/telegram/telegram_user.js";
import { AbstractWidget as AbstractWidget } from "@src/adapters/telegram/widgets/abstract.js";
import { Expected, Status } from "@src/utils/expected.js";
import { Language, user_tg_username } from "@src/entities/user.js";
import { GlobalFormatter, log_and_return } from "@src/utils.js";
import { FeedbackActions } from "@src/use_cases/feedback_actions.js";
import { Feedback } from "@src/entities/feedback.js";

type State = "initial" | "waiting_details" | "choose_privacy" | "waiting_confirmation" | "finished" | "failed";

export class FeedbackWidget implements AbstractWidget {

    private journal: Journal;
    private state: State = "initial";
    private message_id?: number;

    private _buttons?: {
        cancel: TelegramBot.InlineKeyboardButton;
        send_anonymous: TelegramBot.InlineKeyboardButton;
        send_from_me: TelegramBot.InlineKeyboardButton;
        send_from_my_party: TelegramBot.InlineKeyboardButton;
        confirm: TelegramBot.InlineKeyboardButton;
    };

    private feedback: Partial<Feedback> = {};

    constructor(private user: TelegramUser, parent_journal: Journal)
    {
        this.journal = parent_journal.child("activity.feedback");
    }

    public on_details_provided(details: string): void {
        this.journal.log().info({ details }, "details added");
        this.feedback.details = details;
    }

    public async start(): Promise<Status> {
        this.journal.log().info("started");
        const status = await this.create_widget();
        if (!status.ok) {
            return status.wrap_error("failed to create widget");
        }
        if (!this.feedback.details || this.feedback.details.length == 0) {
            return await this.switch_state("waiting_details");
        } else {
            return await this.switch_state("choose_privacy");
        }
    }

    public async interrupt(): Promise<Status> {
        this.journal.log().info("interrupted");
        this.release_resources();
        this.state = "initial";
        return Expected.ok(undefined);
    }

    public waits_for_message(): boolean {
        return ["waiting_details"].includes(this.state);
    }

    public async consume_message(message: TelegramBot.Message): Promise<Status> {
        if (this.state === "waiting_details") {
            if (message.text && message.text.trim().length > 0) {
                this.on_details_provided(message.text);
                const status = await this.switch_state("choose_privacy");
                if (!status.ok) {
                    return status.wrap_error(`switching to choose_privacy state`);
                }
            }
            return Expected.ok(undefined);
        } else {
            return Expected.err("unexpected message");
        }
    }

    public finished(): boolean {
        return ["finished", "failed"].includes(this.state);
    }

    private async create_widget(): Promise<Status> {
        if (this.message_id) {
            return Expected.ok(undefined);
        }

        const sent_status = await this.user.send_message(
            Messages.creating_widget_text(this.user.info().lang),
            {
                reply_markup: {
                    inline_keyboard: [
                        [this.buttons().cancel]
                    ]
                }
            },
        );
        if (!sent_status.ok) {
            return sent_status.wrap_error("failed to create widget");
        }
        this.message_id = sent_status.value;
        return Expected.ok(undefined);
    }

    private async switch_state(new_state: State): Promise<Status> {
        this.journal.log().info({ old: this.state, new: new_state }, "switching state");
        this.state = new_state;
        return await this.update_widget();
    }

    private async update_widget(): Promise<Status> {
        if (this.state === "initial") {
            return Expected.ok(undefined);
        }
        if (!this.message_id) {
            return Expected.err("no message id");
        }
        switch (this.state) {
            case "waiting_details":
                return this.user.edit_message(this.message_id, {
                    text: Messages.ask_for_details_text(this.user.info().lang),
                    inline_keyboard: [
                        [this.buttons().cancel]
                    ]
                });
            case "choose_privacy":
                return this.user.edit_message(this.message_id, {
                    text: Messages.select_privacy_widget_text(this.feedback, this.user.info().lang),
                    inline_keyboard: [
                        [this.buttons().send_anonymous],
                        [this.buttons().send_from_my_party],
                        [this.buttons().send_from_me],
                        [this.buttons().cancel],
                    ]
                });
            case "waiting_confirmation":
                return this.user.edit_message(this.message_id, {
                    text: Messages.confirm_widget_text(this.feedback, this.user.info().lang),
                    inline_keyboard: [
                        [this.buttons().confirm],
                        [this.buttons().cancel],
                    ]
                });
            case "finished":
                await this.release_resources();
                return Expected.ok(undefined);
            case "failed":
                return this.user.edit_message(this.message_id, {
                    text: Messages.failed_widget_text(this.user.info().lang),
                    inline_keyboard: undefined
                });
            default:
                return Expected.ok(undefined);
        }
    }

    private async on_cancel(): Promise<Status> {
        await this.release_resources();
        return await this.switch_state("initial");
    }

    private async set_privacy(mode: "by_user" | "by_party" | "anonymous"): Promise<Status> {
        if (mode == "by_user") {
            this.feedback.who = {
                name_surname: `${this.user.info().name} ${this.user.info().surname}`,
                tgid: user_tg_username(this.user.info())
            };
        }
        if (mode == "by_party" || mode == "by_user") {
            this.feedback.voice = this.user.info().voice;
        }
        return await this.switch_state("waiting_confirmation");
    }

    private async publish_feedback(): Promise<Status> {
        if (!this.feedback.details || this.feedback.details.trim().length == 0) {
            this.journal.log().error("No any details provided");
            return await this.switch_state("failed");
        }

        this.feedback.date = new Date();
        const status = await FeedbackActions.register_new_feedback(
            this.user,
            this.feedback as Feedback,
            this.journal
        );
        if (!status.ok) {
            await this.switch_state("failed");
            // HACK: message_id is set to undefined to prevent removing message during
            // release_resources() call
            this.message_id = undefined;
            await this.release_resources();
            return log_and_return(status, this.journal.log());
        }
        return await this.switch_state("finished");
    }

    private buttons() {
        if (this._buttons) {
            return this._buttons;
        }

        const lang = this.user.info().lang;
        const text = (() => {
            switch (lang) {
                case Language.RU:
                    return {
                        cancel: "Отмена",
                        send_from_me: "Отправить от моего имени",
                        send_from_my_party: "Отправить от моей партии",
                        send_anonymous: "Отправить анонимно",
                        confirm: "Отправить!",
                    };
                case Language.EN:
                default:
                    return {
                        cancel: "Cancel",
                        send_from_me: "Send on my behalf",
                        send_from_my_party: "Send on behalf of my party",
                        send_anonymous: "Send anonymously",
                        confirm: "Send!",
                    }
            }
        })();

        this._buttons = {
            cancel: this.user.create_keyboard_button(
                text.cancel,
                "cancel",
                () => this.on_cancel()),
            send_from_me: this.user.create_keyboard_button(
                text.send_from_me,
                "send_from_me",
                async () => await this.set_privacy("by_user")),
            send_from_my_party: this.user.create_keyboard_button(
                text.send_from_my_party,
                "send_from_my_party",
                async () => await this.set_privacy("by_party")),
            send_anonymous: this.user.create_keyboard_button(
                text.send_anonymous,
                "send_anonymous",
                async () => await this.set_privacy("anonymous")),
            confirm: this.user.create_keyboard_button(
                text.confirm,
                "confirm",
                async () => await this.publish_feedback()),
        }
        return this._buttons;
    }

    private async release_resources() {
        if (this.message_id) {
            await this.user.delete_message(this.message_id);
        }
        this.message_id = undefined;
        if (this._buttons) {
            const buttons = Object.values(this._buttons);
            buttons.forEach(button => this.user.remove_keyboard_button(button));
            this._buttons = undefined;
        }
    }
}


class Messages {
    static creating_widget_text(lang: Language): string {
        switch (lang) {
            case Language.RU:
                return "Секунду, я готовлю сообщение...";
            case Language.EN:
            default:
                return "Just a moment, I'm preparing a message...";
        }
    }

    static ask_for_details_text(lang: Language): string {
        switch (lang) {
            case Language.RU:
                return "Расскажи, чем хочешь поделиться и я передам это орг. группе";
            case Language.EN:
            default:
                return "Tell me what you want to share and I will pass it to the organizing group";
        }
    }

    static select_privacy_widget_text(feedback: Partial<Feedback>, lang: Language): string {
        const parts = (() => {
            switch (lang) {
                case Language.RU:
                    return {
                        header: "Вот твой фидбек:",
                        question: "👇 Выбери, как ты хочешь отправить фидбек 👇"
                    }
                case Language.EN:
                default:
                    return {
                        header: "Here is your feedback:",
                        question: "👇 Choose how you want to send the feedback 👇"
                    }
            }
        })();

        const formatter = GlobalFormatter.instance();
        return [
            formatter.bold(parts.header),
            formatter.quote(feedback.details!),
            parts.question
        ].join("\n\n");
    }

    static confirm_widget_text(feedback: Partial<Feedback>, lang: Language): string {
        const parts = (() => {
            switch (lang) {
                case Language.RU:
                    return {
                        header: "Я готов отправить фидбек!",
                        on_behalf: "От кого",
                        anonymously: "анонимно",
                        question: "👇 Пожалуйста, подтверди 👇"
                    }
                case Language.EN:
                default:
                    return {
                        header: "I'm ready to send the feedback!",
                        on_behalf: "From",
                        anonymously: "anonymously",
                        question: "👇 Please, confirm 👇"
                    }
            }
        })();

        let who: string = parts.anonymously;
        if (feedback.who) {
            who = `${feedback.who.name_surname} (@${feedback.who.tgid})`;
        } else if (feedback.voice) {
            who = feedback.voice;
        }

        const formatter = GlobalFormatter.instance();
        return [
            parts.header,
            formatter.quote(feedback.details!),
            `${formatter.bold(parts.on_behalf)}: ${who}`,
            parts.question
        ].join("\n\n");
    }

    static failed_widget_text(lang: Language): string {
        switch (lang) {
            case Language.RU:
                return "🛑 Оу, что-то пошло не так, я не смог отправить твой фидбек 🤦‍♂️";
            case Language.EN:
            default:
                return "🛑 Oh, something went wrong, I couldn't send your feedback 🤦‍♂️";
        }
    }
}