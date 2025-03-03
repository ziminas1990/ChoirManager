import TelegramBot from "node-telegram-bot-api";

import { Status } from "../../status.js";
import { Language } from "../database.js";
import { Deposit, DepositChange } from "../fetchers/deposits_fetcher.js";
import { DepositsTrackerEvent } from "../logic/deposits_tracker.js";
import { BaseActivity } from "./base_activity.js";
import { UserLogic } from "../logic/user.js";
import { Dialog } from "../logic/dialog.js";


export class DepositActivity extends BaseActivity {

    // To duplicate all notifications to them
    static accountants: UserLogic[] = []

    private messages: Messages

    constructor(user: UserLogic)
    {
        super();
        this.messages = new Messages(user.data.lang)
    }

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
        return await dialog.send_message(this.messages.deposit_info(info));
    }

    async on_deposit_event(event: DepositsTrackerEvent, dialog: Dialog): Promise<Status> {
        if (event.what == "deposit_change") {
            const message = this.messages.deposit_change(event.deposit, event.changes);
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
                await dialog.send_message(
                    `Notification for ${who.name} ${who.surname} (@${who.tgid}):\n\n${message}`);
            }
        }
    }
}

const monthes: {[key: string]: string[]} = {
    "ru": ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
           "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"],
    "en": ["January", "February", "March", "April", "May", "June",
           "July", "August", "September", "October", "November", "December"]
}

class Messages {
    constructor(public readonly lang: Language) {}

    deposit_change(deposit: Deposit, change: DepositChange): string {
        const lines: string[] = [];
        lines.push(this.deposit_changes_test());
        lines.push("");

        if (change.balance) {
            lines.push(this.balance_changed(change.balance))
        } else {
            lines.push(this.balance(deposit.balance));
        }

        for (const membership_change of change.membership ?? []) {
            const [date, before, after] = membership_change;
            lines.push(this.membership_change(date, before, after));
        }

        lines.push("");
        lines.push(this.waiting_membership(deposit));

        return lines.join("\n")
    }

    deposit_changes_test(): string {
        return this.lang == "ru" ? "Изменения на твоём депозите" : "Deposit changes";
    }

    credited(amount: number): string {
        return this.lang == "ru" ? `начислено ${amount} GEL` : `credited ${amount} GEL`;
    }

    withdrawn(amount: number): string {
        return this.lang == "ru" ? `списано ${amount} GEL` : `withdrawn ${amount} GEL`;
    }

    balance(amount: number): string {
        return this.lang == "ru" ? "Средств на депозите:" : "Funds on deposit:" + ` ${amount} GEL`;
    }

    balance_changed(change: [number, number]): string {
        const diff = change[1] - change[0];
        const diff_str = diff > 0 ? this.credited(diff) : this.withdrawn(diff);

        return [
            this.lang == "ru" ? "Средств на депозите:" : "Funds on deposit:",
            `${change[0]} -> ${change[1]}`,
            `(${diff_str})`
        ].join(" ");
    }

    membership_change(date: Date, before: number, after: number): string {
        const month = monthes[this.lang][date.getMonth()]

        return [
            this.lang == "ru" ? "Членский взнос за " : "Membership for " + `${month}:`,
            `${before} -> ${after}`
        ].join(" ");
    }

    deposit_info(deposit: Deposit): string {
        const lines = [
            this.lang == "ru" ? "Информация о твоём депозите:" : "You deposit:",
            "",
            this.balance(deposit.balance)
        ];

        const now = new Date();
        const this_month = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
        const month = monthes[this.lang][this_month.getMonth()];
        const paid = deposit.membership.get(this_month.getTime()) ?? 0;

        lines.push(this.lang == "ru" ? "Внесено за" : "Paid for" + ` ${month}: ${paid} GEL`)
        lines.push("")
        lines.push(this.waiting_membership(deposit));
        return lines.join("\n")
    }

    waiting_membership(deposit: Deposit): string {
        const now = new Date();
        const this_month = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
        const month = monthes[this.lang][this_month.getMonth()];
        const paid = deposit.membership.get(this_month.getTime()) ?? 0;

        const total = paid + deposit.balance;

        if (total < 70) {
            const diff = 70 - total;
            if (this.lang == "ru") {
                return `За ${month} нужно внести ещё ${diff} GEL`;
            } else {
                return `You are expected to pay another ${diff} GEL for ${month}`;
            }
        }

        if (this.lang == "ru") {
            return `За ${month} ничего платить не нужно`;
        } else {
            return `Membership fee for ${month} is paid `;
        }

    }
}
