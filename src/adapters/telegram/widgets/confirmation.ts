import TelegramBot from "node-telegram-bot-api";

import { AbstractWidget } from "@src/adapters/telegram/widgets/abstract.js";
import { TelegramUser } from "@src/adapters/telegram/telegram_user.js";
import { ConfirmationError } from "@src/interfaces/user_agent.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";
import { return_fail } from "@src/utils.js";

export class ConfirmationWidget implements AbstractWidget {
    private journal: Journal;
    private message_id?: number;
    private timeout_id?: ReturnType<typeof setTimeout>;
    private buttons?: {
        positive: TelegramBot.InlineKeyboardButton;
        negative: TelegramBot.InlineKeyboardButton;
    };
    private settled = false;
    private readonly answer_promise: Promise<Expected<"positive" | "negative">>;
    private resolve_answer!: (value: Expected<"positive" | "negative">) => void;

    constructor(
        private readonly user: TelegramUser,
        parent_journal: Journal,
        private readonly question: string,
        private readonly positive_label: string,
        private readonly negative_label: string,
        private readonly lifetime_sec?: number,
    ) {
        this.journal = parent_journal.child("widget.confirmation");
        this.answer_promise = new Promise((resolve) => {
            this.resolve_answer = resolve;
        });
    }

    async start(): Promise<Status> {
        this.buttons = {
            positive: this.user.create_keyboard_button(
                this.positive_label,
                "confirmation.positive",
                async () => await this.on_choice("positive"),
                this.lifetime_sec,
            ),
            negative: this.user.create_keyboard_button(
                this.negative_label,
                "confirmation.negative",
                async () => await this.on_choice("negative"),
                this.lifetime_sec,
            ),
        };

        const sent = await this.user.send_message(this.question, {
            reply_markup: {
                inline_keyboard: [[this.buttons.positive, this.buttons.negative]],
            },
        });
        if (!sent.ok) {
            await this.release();
            this.settle(sent.cast_error());
            return sent.wrap_error("failed to send confirmation");
        }
        this.message_id = sent.value;

        if (this.lifetime_sec !== undefined && this.lifetime_sec > 0) {
            this.timeout_id = setTimeout(() => {
                void this.on_timeout();
            }, this.lifetime_sec * 1000);
        }

        return Expected.ok(undefined);
    }

    async interrupt(): Promise<Status> {
        await this.release();
        this.settle(return_fail("confirmation interrupted", this.journal.log()));
        return Expected.ok(undefined);
    }

    waits_for_message(): boolean {
        return false;
    }

    async consume_message(_: TelegramBot.Message): Promise<Status> {
        return Expected.ok(undefined);
    }

    finished(): boolean {
        return this.settled;
    }

    answer(): Promise<Expected<"positive" | "negative">> {
        return this.answer_promise;
    }

    private settle(value: Expected<"positive" | "negative">): void {
        if (this.settled) {
            return;
        }
        this.settled = true;
        this.resolve_answer(value);
    }

    private async on_choice(choice: "positive" | "negative"): Promise<Status> {
        await this.release();
        this.settle(Expected.ok(choice));
        return Expected.ok(undefined);
    }

    private async on_timeout(): Promise<void> {
        await this.release();
        const timed_out = return_fail<"positive" | "negative">(
            "confirmation timed out",
            this.journal.log(),
        ).set_error_code(ConfirmationError.TimedOut);
        this.settle(timed_out);
    }

    private async release(): Promise<void> {
        if (this.timeout_id !== undefined) {
            clearTimeout(this.timeout_id);
            this.timeout_id = undefined;
        }
        if (this.buttons) {
            this.user.remove_keyboard_button(this.buttons.positive);
            this.user.remove_keyboard_button(this.buttons.negative);
            this.buttons = undefined;
        }
        if (this.message_id !== undefined) {
            await this.user.edit_message(this.message_id, { inline_keyboard: [] });
            this.message_id = undefined;
        }
    }
}
