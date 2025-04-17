import TelegramBot from "node-telegram-bot-api";

import { AbstractWidget } from "@src/adapters/telegram/widgets/abstract.js";
import { ChoristerStatistics } from "@src/entities/statistics.js";
import { Status } from "@src/status.js";
import { TelegramUser } from "@src/adapters/telegram/telegram_user.js";
import { Journal } from "@src/journal.js";
import { Language } from "@src/database.js";
import { GlobalFormatter } from "@src/utils.js";
import { Analytic } from "@src/use_cases/analytic";


export class ChoristerStatisticsWidget implements AbstractWidget {

    private journal: Journal;
    private data?: ChoristerStatistics;

    private _buttons?: {
        month: TelegramBot.InlineKeyboardButton;
        two_month: TelegramBot.InlineKeyboardButton;
        three_month: TelegramBot.InlineKeyboardButton;
        six_month: TelegramBot.InlineKeyboardButton;
        all_time: TelegramBot.InlineKeyboardButton;
        close: TelegramBot.InlineKeyboardButton;
    };
    private message_id?: number;

    constructor(private user: TelegramUser, parent_journal: Journal)
    {
        this.journal = parent_journal.child("activity.statistics");
    }

    async start(): Promise<Status> {
        return await this.show_statictics(30);
    }

    async interrupt(): Promise<Status> { return Status.ok(); }

    waits_for_message(): boolean { return false; }

    async consume_message(_: TelegramBot.Message): Promise<Status> {
        return Status.ok();
    }

    // Return true if activity has finished
    finished(): boolean { return this.message_id == undefined; }

    private buttons() {
        if (this._buttons) {
            return this._buttons;
        }

        const lang = this.user.info().lang;
        const text = (() => {
            switch (lang) {
                case Language.RU:
                    return {
                        month: "За 30 дней",
                        two_month: "За 60 дней",
                        three_month: "За 90 дней",
                        six_month: "За 180 дней",
                        all_time: "За все время",
                        close: "❌",
                    };
                case Language.EN:
                default:
                    return {
                        month: "For 30 days",
                        two_month: "For 60 days",
                        three_month: "For 90 days",
                        six_month: "For 180 days",
                        all_time: "All time",
                        close: "❌",
                    }
            }
        })();

        this._buttons = {
            month: this.user.create_keyboard_button(
                text.month,
                "month",
                () => this.show_statictics(30)),
            two_month: this.user.create_keyboard_button(
                text.two_month,
                "two_month",
                () => this.show_statictics(60)),
            three_month: this.user.create_keyboard_button(
                text.three_month,
                "three_month",
                () => this.show_statictics(90)),
            six_month: this.user.create_keyboard_button(
                text.six_month,
                "six_month",
                () => this.show_statictics(180)),
            all_time: this.user.create_keyboard_button(
                text.all_time,
                "all_time",
                () => this.show_statictics()),
            close: this.user.create_keyboard_button(
                text.close,
                "close",
                () => this.on_cancel()),
        }
        return this._buttons;
    }

    private get_inline_keyboard(): TelegramBot.InlineKeyboardButton[][] {
        const buttons = this.buttons();
        return [
            [
                buttons.month,
                buttons.two_month,
            ],
            [
                buttons.three_month,
                buttons.six_month,
            ],
            [
                buttons.all_time,
                buttons.close,
            ],
        ];
    }

    private async on_cancel(): Promise<Status> {
        if (this.message_id) {
            await this.user.delete_message(this.message_id);
        }
        return Status.ok();
    }

    private async show_statictics(period_days?: number): Promise<Status> {
        this.journal.log().info({ period_days }, "show statistics");

        const statistic = Analytic.chorister_statistic_request(this.user.userid(), period_days);
        if (!statistic.ok() || !statistic.value) {
            const status = await this.update_widget(Messages.fail_message(
                this.user.info().lang
            ));
            if (!status.ok()) {
                return status.wrap("failed to update widget");
            }
            return statistic.wrap("failed to collect statistics");
        }

        this.data = statistic.value;
        const text = Messages.statistics(this.data, this.user.info().lang);
        return this.update_widget(text);
    }

    private async update_widget(text: string): Promise<Status> {
        if (!this.message_id) {
            const status = await this.user.send_message(text, {
                reply_markup: {
                    inline_keyboard: this.get_inline_keyboard(),
                },
            });
            if (!status.ok()) {
                return status.wrap("failed to send message");
            }
            this.message_id = status.value;
            return Status.ok();
        } else {
            return await this.user.edit_message(this.message_id, {
                text: text,
                inline_keyboard: this.get_inline_keyboard(),
            });
        }
    }

}

class Messages {
    static statistics(data: ChoristerStatistics, lang: Language): string {
        const parts = (() => {
            switch (lang) {
                case Language.RU:
                    return {
                        header: "Твоя статистика посещений за последние",
                        days: "дней",
                        rehersals_status: "Ты посетил(а) {visited_rehersals} из {total_rehersals} репетиций",
                        hours_status: "Ты репетировал(а) {visited_hours} из {total_hours} часов",
                        attendance: "Твоя посещаемость",
                    }
                case Language.EN:
                default:
                    return {
                        header: "Your statistics for the last",
                        days: "days",
                        rehersals_status: "You visited {visited_rehersals} out of {total_rehersals} rehearsals",
                        hours_status: "You spent {visited_hours} out of {total_hours} hours",
                        attendance: "Your attendance",
                    }
            }
        })();

        const formatter = GlobalFormatter.instance();

        const attendance = data.visited_hours / data.total_hours * 100;
        const diff_ms = data.period.to.getTime() - data.period.from.getTime();
        const days = Math.ceil(diff_ms / (1000 * 60 * 60 * 24));

        const rehersals_stat = parts.rehersals_status
            .replace("{visited_rehersals}", data.visited_rehersals.toFixed(0))
            .replace("{total_rehersals}", data.total_rehersals.toFixed(0));

        const hours_stat = parts.hours_status
            .replace("{visited_hours}", data.visited_hours.toFixed(0))
            .replace("{total_hours}", data.total_hours.toFixed(0));

        return [
            formatter.bold(`${parts.header} ${days} ${parts.days}:`),
            rehersals_stat,
            hours_stat,
            `${parts.attendance}: ${attendance.toFixed(0)}%`,
        ].join("\n");
    }

    static fail_message(lang: Language): string {
        switch (lang) {
            case Language.RU: return "Странно, не получилось собрать статистику 🤷";
            case Language.EN:
            default:
                return "I couldn't collect statistics for some reason 🤷";
        }
    }

}