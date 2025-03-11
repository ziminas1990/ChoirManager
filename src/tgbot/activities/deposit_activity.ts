import TelegramBot from "node-telegram-bot-api";

import { Status } from "../../status.js";
import { Language } from "../database.js";
import { Deposit, DepositChange } from "../fetchers/deposits_fetcher.js";
import { DepositsTrackerEvent } from "../logic/deposits_tracker.js";
import { BaseActivity } from "./base_activity.js";
import { UserLogic } from "../logic/user.js";
import { Dialog } from "../logic/dialog.js";
import pino from "pino";


export class DepositActivity extends BaseActivity {
    private logger: pino.Logger;
    constructor(parent_logger: pino.Logger) {
        super();
        this.logger = parent_logger.child({ activity: "deposit" });
    }

    // To duplicate all notifications to them
    static accountants: UserLogic[] = []

    static add_accountant(accountant: UserLogic) {
        this.accountants.push(accountant);
    }

    async proceed(_: Date): Promise<Status> {
        throw new Error("Not implemented");
    }

    async start(): Promise<Status> {
        throw new Error("Not implemented");
    }

    async on_message(_: TelegramBot.Message): Promise<Status> {
        throw new Error("Not implemented");
    }

    async on_callback(_: TelegramBot.CallbackQuery): Promise<Status> {
        throw new Error("Not implemented");
    }

    async send_deposit_info(info: Deposit, dialog: Dialog): Promise<Status> {
        return await dialog.send_message(Messages.deposit_info(info, dialog.user.data.lang));
    }

    async on_deposit_event(event: DepositsTrackerEvent, dialog: Dialog): Promise<Status> {
        if (event.what == "deposit_change") {
            const message = Messages.deposit_change(event.deposit, event.changes, dialog.user.data.lang);
            const status = await dialog.send_message(message);
            await this.notify_accountants(dialog, message);
            return status;
        }
        return Status.ok();
    }

    async notify_accountants(user_dialog: Dialog, message: string) {
        const who = user_dialog.user.data;
        for (const accountant of DepositActivity.accountants) {
            const dialog = accountant.main_dialog();
            if (dialog) {
                const status = await dialog.send_message(
                    `Notification for ${who.name} ${who.surname} (@${who.tgid}):\n\n${message}`);
                if (!status.ok()) {
                    this.logger.warn(`failed to send notification to (@${accountant.data.tgid}): ${status.what()}`);
                }
            }
        }
    }
}

const monthes: {[key in Language]: string[]} = {
    "ru": ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
           "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"],
    "en": ["January", "February", "March", "April", "May", "June",
           "July", "August", "September", "October", "November", "December"]
}

class Messages {

    static deposit_change(deposit: Deposit, change: DepositChange, lang: Language): string {
        const lines: string[] = [];
        lines.push(Messages.deposit_changes_test(lang));
        lines.push("");

        if (change.balance) {
            lines.push(Messages.balance_changed(change.balance, lang))
        } else {
            lines.push(Messages.balance(deposit.balance, lang));
        }

        for (const membership_change of change.membership ?? []) {
            const [date, before, after] = membership_change;
            lines.push(Messages.membership_change(date, before, after, lang));
        }

        lines.push("");
        lines.push(Messages.waiting_membership(deposit, lang));

        return lines.join("\n")
    }

    static deposit_changes_test(lang: Language): string {
        return lang == Language.RU ? "Изменения на твоём депозите" : "Deposit changes";
    }

    static credited(amount: number, lang: Language): string {
        return lang == Language.RU ? `начислено ${amount} GEL` : `credited ${amount} GEL`;
    }

    static withdrawn(amount: number, lang: Language): string {
        return lang == Language.RU ? `списано ${amount} GEL` : `withdrawn ${amount} GEL`;
    }

    static balance(amount: number, lang: Language): string {
        return (lang == Language.RU ? "Средств на депозите:" : "Funds on deposit:") + ` ${amount} GEL`;
    }

    static balance_changed(change: [number, number], lang: Language): string {
        const diff = change[1] - change[0];
        const diff_str = diff > 0 ? Messages.credited(diff, lang) : Messages.withdrawn(diff, lang);

        return [
            lang == Language.RU ? "Средств на депозите:" : "Funds on deposit:",
            `${change[0]} -> ${change[1]}`,
            `(${diff_str})`
        ].join(" ");
    }

    static membership_change(date: Date, before: number, after: number, lang: Language): string {
        const month = monthes[lang][date.getMonth()]

        return [
            lang == Language.RU ? "Членский взнос за" : "Membership for",
            `${month}: ${before} -> ${after}`
        ].join(" ");
    }

    static deposit_info(deposit: Deposit, lang: Language): string {
        const lines = [
            lang == Language.RU ? "Информация о твоём депозите:" : "You deposit:",
            "",
            Messages.balance(deposit.balance, lang)
        ];

        const now = new Date();
        const this_month = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
        const month = monthes[lang][this_month.getMonth()];
        const paid = deposit.membership.get(this_month.getTime()) ?? 0;

        lines.push((lang == Language.RU ? "Внесено за" : "Paid for") + ` ${month}: ${paid} GEL`)
        lines.push("")
        lines.push(Messages.waiting_membership(deposit, lang));
        return lines.join("\n")
    }

    static waiting_membership(deposit: Deposit, lang: Language): string {
        const now = new Date();
        const this_month = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
        const month = monthes[lang][this_month.getMonth()];
        const paid = deposit.membership.get(this_month.getTime()) ?? 0;

        const total = paid + deposit.balance;

        if (total < 70) {
            const diff = 70 - total;
            if (lang == Language.RU) {
                return `За ${month} нужно внести ещё ${diff} GEL`;
            } else {
                return `You are expected to pay another ${diff} GEL for ${month}`;
            }
        }

        if (lang == Language.RU) {
            return `За ${month} ничего платить не нужно`;
        } else {
            return `Membership fee for ${month} is paid `;
        }

    }
}
