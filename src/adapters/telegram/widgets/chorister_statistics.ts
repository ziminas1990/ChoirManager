import TelegramBot from "node-telegram-bot-api";

import { ChoristerAttendanceStat } from "@src/entities/statistics.js";
import { Expected, Status } from "@src/utils/expected.js";
import { TelegramUser } from "@src/adapters/telegram/telegram_user.js";
import { IJournal } from "@src/interfaces/journal.js";
import { Language, Role, user_has_role, user_tg_username } from "@src/entities/user.js";
import { apply_interval, GlobalFormatter, shorten } from "@src/utils.js";
import { Analytic } from "@src/use_cases/analytic.js";
import { Runtime } from "@src/runtime.js";
import { Environment } from "@src/components/environment.js";

type StatisticsAction =
    | { type: "close" }
    | { type: "period"; days: number | undefined };

export class ChoristerStatisticsWidget {
    private static readonly prefix = "stats:v1:";
    private static readonly period_days = [30, 60, 90, 180] as const;
    private readonly journal: IJournal;

    constructor(
        private readonly user: TelegramUser,
        parent_journal: IJournal,
        private readonly message_id?: number,
    ) {
        this.journal = parent_journal.child("activity.statistics");
    }

    static matches(data: string | undefined): boolean {
        return data?.startsWith("stats:") ?? false;
    }

    static async on_callback(
        query: TelegramBot.CallbackQuery,
        user: TelegramUser,
        journal: IJournal,
    ): Promise<Status> {
        const action = this.parse_action(query.data);
        const message = Helpers.callback_private_message(query, user);
        if (!action || !message.ok) {
            await user.send_message(Messages.unavailable(user.info().lang));
            return action
                ? message.as_status()
                : Expected.err("unsupported statistics callback action");
        }

        if (action.type === "close") {
            return await user.delete_message(message.value.message_id);
        }
        const widget = new ChoristerStatisticsWidget(
            user, journal, message.value.message_id);
        return await widget.show_statistics(action.days);
    }

    async start(): Promise<Status> {
        return await this.show_statistics(30);
    }

    private get_inline_keyboard(): TelegramBot.InlineKeyboardButton[][] {
        const ru = this.user.info().lang === Language.RU;
        const period_button = (days: number): TelegramBot.InlineKeyboardButton => ({
            text: ru ? `За ${days} дней` : `For ${days} days`,
            callback_data: ChoristerStatisticsWidget.prefix + days,
        });
        const periods = ChoristerStatisticsWidget.period_days.map(period_button);
        return [
            periods.slice(0, 2),
            periods.slice(2),
            [
                {
                    text: ru ? "За все время" : "All time",
                    callback_data: ChoristerStatisticsWidget.prefix + "all",
                },
                { text: "❌", callback_data: ChoristerStatisticsWidget.prefix + "close" },
            ],
        ];
    }

    private static parse_action(data: string | undefined): StatisticsAction | undefined {
        if (!data?.startsWith(this.prefix)) {
            return undefined;
        }
        const raw = data.slice(this.prefix.length);
        if (raw === "close") {
            return { type: "close" };
        }
        if (raw === "all") {
            return { type: "period", days: undefined };
        }
        const days = Number.parseInt(raw, 10);
        if (!Number.isSafeInteger(days) || String(days) !== raw
            || !(this.period_days as readonly number[]).includes(days))
        {
            return undefined;
        }
        return { type: "period", days };
    }

    private async show_statistics(period_days?: number): Promise<Status> {
        this.journal.info({ period_days }, "show statistics");
        try {
            const resolved = await Environment.global.user_service.resolve_user({
                system_id: this.user.userid(),
            });
            if (!resolved.ok) {
                return await this.report_failure(resolved.as_status());
            }
            const profile = resolved.value;
            if (!profile || (!user_has_role(profile, Role.Chorister)
                && !user_has_role(profile, Role.Manager)))
            {
                await this.user.send_message(Messages.access_denied(this.user.info().lang));
                return Expected.err("user has no permission to view statistics");
            }
            this.user.set_user_info(profile);

            const end = new Date();
            const begin = period_days
                ? apply_interval(end, { days: -period_days })
                : new Date(0);
            const statistic = Analytic.chorister_statistic_request(
                Runtime.get_instance().get_database(),
                user_tg_username(profile),
                profile.voice,
                begin,
                end,
            );
            if (!statistic.ok) {
                return await this.report_failure(statistic.as_status());
            }
            const updated = await this.update_widget(
                Messages.statistics(statistic.value, profile.lang));
            return updated.ok ? updated : await this.report_failure(updated);
        } catch (error) {
            return await this.report_failure(Expected.exception("failed to collect statistics", error));
        }
    }

    private async report_failure(status: Status): Promise<Status> {
        this.journal.warning(`Statistics request failed: ${status.error}`);
        await this.user.send_message(Messages.fail_message(this.user.info().lang));
        return status;
    }

    private async update_widget(text: string): Promise<Status> {
        const keyboard = this.get_inline_keyboard();
        if (this.message_id === undefined) {
            return (await this.user.send_message(text, {
                reply_markup: { inline_keyboard: keyboard },
            })).as_status();
        }
        const updated = await this.user.edit_message(this.message_id, {
            text,
            inline_keyboard: keyboard,
        });
        // Repeated clicks can produce identical text and keyboard contents.
        if (!updated.ok && updated.error.includes("message is not modified")) {
            return Expected.ok(undefined);
        }
        return updated;
    }
}

class Messages {
    static access_denied(lang: Language): string {
        return lang === Language.RU
            ? "У тебя нет доступа к статистике. Обратись к руководителю хора, чтобы уточнить права доступа."
            : "You do not have permission to view statistics. Contact the choir manager to check your access.";
    }

    static unavailable(lang: Language): string {
        return lang === Language.RU
            ? "Эта кнопка статистики недоступна. Открой новый виджет через «Статистика»."
            : "This statistics button is unavailable. Open a new widget using Statistics.";
    }

    static statistics(data: ChoristerAttendanceStat, lang: Language): string {
        const parts = (() => {
            switch (lang) {
                case Language.RU:
                    return {
                        header: "Твоя статистика посещений за последние",
                        days: "дней",
                        rehersals_status: "Ты посетил(а) {visited_rehersals} из {total_rehersals} репетиций",
                        hours_status: "Ты репетировал(а) {visited_hours} из {total_hours} часов",
                        attendance: "Твоя посещаемость",
                        songs: "Твоя статистика по произведениям",
                        of: "из",
                    }
                case Language.EN:
                default:
                    return {
                        header: "Your statistics for the last",
                        days: "days",
                        rehersals_status: "You visited {visited_rehersals} out of {total_rehersals} rehearsals",
                        hours_status: "You spent {visited_hours} out of {total_hours} hours",
                        attendance: "Your attendance",
                        songs: "Your statistics by songs",
                        of: "out of",
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

        const songs_stat = Array.from(data.songs.entries())
        .sort((a, b) => b[1].actual - a[1].actual)
        .map(([name, stat]) => {
            return [
                shorten(name, 16).padEnd(16),
                (stat.actual / 60).toFixed(1).padStart(4),
                parts.of,
                (stat.ideal / 60).toFixed(1).padEnd(4),
                `~${((stat.actual / stat.ideal) * 100).toFixed(0)}%`.padStart(5),
            ].join(" ");
        }).join("\n");

        return [
            formatter.bold(`${parts.header} ${days} ${parts.days}:`),
            rehersals_stat,
            hours_stat,
            `${parts.attendance}: ${attendance.toFixed(0)}%`,
            "",
            parts.songs,
            formatter.preformatted(songs_stat),
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

class Helpers {
    // Returns the callback message when it is a private chat owned by the user
    // with a usable message id.
    static callback_private_message(
        query: TelegramBot.CallbackQuery,
        user: TelegramUser,
    ): Expected<TelegramBot.Message> {
        const message = query.message;
        if (!message) {
            return Expected.err("callback has no message");
        }
        if (message.chat.type !== "private") {
            return Expected.err("callback message is not from a private chat");
        }
        if (message.chat.id !== user.private_chat_id()) {
            return Expected.err("callback chat does not belong to the user");
        }
        if (query.from.id !== message.chat.id) {
            return Expected.err("callback sender does not match the chat owner");
        }
        if (!Number.isSafeInteger(message.message_id) || message.message_id <= 0) {
            return Expected.err("callback message id is invalid");
        }
        return Expected.ok(message);
    }
}
