import { MessageOptions, GridButton } from "@src/interfaces/user_agent.js";
import * as TelegramBot from "node-telegram-bot-api";

import { ChoristerAttendanceStat, IAnalyticService } from "@src/interfaces/analytic_service.js";
import { Expected, Status } from "@src/utils/expected.js";
import { TelegramUser } from "@src/adapters/telegram/telegram_user.js";
import { IJournal } from "@src/interfaces/journal.js";
import { Language, Role, user_has_role } from "@src/entities/user.js";
import { apply_interval, escape_html } from "@src/utils.js";
import { Environment } from "@src/components/environment.js";

const statistics_prefix = "stats:v1:";
const statistics_period_days = [30, 60, 90, 180] as const;

type StatisticsAction =
    | { type: "close" }
    | { type: "period"; days: number | undefined };

function analytic_service(): IAnalyticService {
    return Environment.global.analytic_service;
}

export class ChoristerStatisticsWidget {
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

    private static parse_action(data: string | undefined): StatisticsAction | undefined {
        if (!data?.startsWith(statistics_prefix)) {
            return undefined;
        }
        const raw = data.slice(statistics_prefix.length);
        if (raw === "close") {
            return { type: "close" };
        }
        if (raw === "all") {
            return { type: "period", days: undefined };
        }
        const days = Number.parseInt(raw, 10);
        if (!Number.isSafeInteger(days) || String(days) !== raw
            || !(statistics_period_days as readonly number[]).includes(days))
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
            const statistic = await analytic_service().chorister_statistic_request({
                system_id: profile.id.system_id,
                from: begin,
                to: end,
            });
            if (!statistic.ok) {
                return await this.report_failure(statistic.as_status());
            }
            const updated = await this.update_widget(
                Messages.statistics(statistic.value, profile.lang, period_days));
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

    private async update_widget(html: string): Promise<Status> {
        const options: MessageOptions = {
            buttons: Messages.controls(this.user.info().lang),
        };
        if (this.message_id === undefined) {
            return (await this.user.send_message(html, options)).as_status();
        }
        const updated = await this.user.edit_message(this.message_id, { text: html, ...options });
        // Repeated clicks can produce identical message contents.
        if (!updated.ok && updated.error.includes("message is not modified")) {
            return Expected.ok(undefined);
        }
        if (!updated.ok && /message (?:can[’']?t|cannot) be edited/i.test(updated.error)) {
            // Embedded controls on older messages prevent edits. Deliver a fresh
            // widget before removing the old one; delivery failures stay errors.
            const replacement = await this.user.send_message(html, options);
            if (!replacement.ok) {
                return replacement.as_status();
            }
            return await this.user.delete_message(this.message_id);
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

    static statistics(data: ChoristerAttendanceStat, lang: Language, period_days?: number): string {
        const ru = lang === Language.RU;
        const covered_days = Math.ceil((data.period.to.getTime() - data.period.from.getTime())
            / (1000 * 60 * 60 * 24));
        const title = period_days === undefined
            ? (ru ? `Твоя статистика посещений за всё время (${covered_days} дн.)`
                : `Your attendance statistics for all time (${covered_days} ${covered_days === 1 ? "day" : "days"})`)
            : (ru ? `Твоя статистика посещений за последние ${period_days} дней`
                : `Your attendance statistics for the last ${period_days} days`);
        const rehearsals = ru
            ? `Ты посетил(а) ${data.visited_rehersals} из ${data.total_rehersals} репетиций`
            : `You visited ${data.visited_rehersals} out of ${data.total_rehersals} rehearsals`;
        const hours = ru
            ? `Ты репетировал(а) ${data.visited_hours.toFixed(1)} из ${data.total_hours.toFixed(1)} часов`
            : `You spent ${data.visited_hours.toFixed(1)} out of ${data.total_hours.toFixed(1)} hours`;
        const attendance = ru ? "Твоя посещаемость" : "Your attendance";
        const songs = ru ? "Твоя статистика по произведениям" : "Your statistics by songs";
        const headings = ru
            ? ["Произведение", "Твои часы", "Всего часов", "Посещаемость"]
            : ["Piece", "Your hours", "Total hours", "Attendance"];
        const song_rows = data.songs.map(stat => [
            "<tr>",
            `<td>${escape_html(stat.name)}</td>`,
            `<td align="right">${(stat.actual / 60).toFixed(1)}</td>`,
            `<td align="right">${(stat.ideal / 60).toFixed(1)}</td>`,
            `<td align="right">${Messages.percent(stat.attendance_percent)}</td>`,
            "</tr>",
        ].join(""));
        const table = data.songs.length === 0
            ? `<p>${ru ? "За этот период нет произведений." : "No pieces for this period."}</p>`
            : [
                "<table bordered striped compact>",
                `<tr>${headings.map(heading => `<th>${heading}</th>`).join("")}</tr>`,
                ...song_rows,
                "</table>",
            ].join("");
        return [
            `<h2>${title}</h2>`,
            `<p>${rehearsals}<br>${hours}<br>${attendance}: ${Messages.percent(data.attendance_percent)}</p>`,
            `<h3>${songs}</h3>`,
            table,
        ].join("\n");
    }

    static controls(lang: Language): GridButton[][] {
        const ru = lang === Language.RU;
        const periods = statistics_period_days.map(days => ({
            text: ru ? `За ${days} дней` : `For ${days} days`,
            callback_data: `${statistics_prefix}${days}`,
        }));
        return [
            periods.slice(0, 2),
            periods.slice(2, 4),
            [
                { text: ru ? "За всё время" : "All time", callback_data: `${statistics_prefix}all` },
                { text: ru ? "Закрыть" : "Close", callback_data: `${statistics_prefix}close`, style: "danger" },
            ],
        ];
    }

    static fail_message(lang: Language): string {
        switch (lang) {
            case Language.RU: return "Странно, не получилось собрать статистику 🤷";
            case Language.EN:
            default:
                return "I couldn't collect statistics for some reason 🤷";
        }
    }

    private static percent(value: number | null): string {
        return value === null ? "—" : `${value.toFixed(0)}%`;
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
