import TelegramBot from "node-telegram-bot-api";

import { Status } from "../../status.js";
import { Language } from "../database.js";
import { Deposit, DepositChange } from "../fetchers/deposits.js";
import { DepositsTrackerEvent } from "../logic/deposits_tracker.js";
import { BaseActivity } from "./base_activity.js";
import { UserLogic } from "../logic/user.js";


export class DepositActivity extends BaseActivity {
    private messages: Messages

    constructor(private user: UserLogic)
    {
        super();
        this.messages = new Messages(user.data.lang)
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

    async on_deposit_event(event: DepositsTrackerEvent): Promise<Status> {
        console.log(`Deposit event on ${this.user.data.tgid}: ${JSON.stringify(event)}`);

        const dialog = this.user.main_dialog();
        if (event.what == "deposit_change" && dialog) {
            const message = this.messages.deposit_change(event.deposit, event.changes);
            await dialog.send_message(message);
        }
        return Status.ok();
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
        lines.push("**" + this.deposit_changes_test() + "**");
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
            `${change[0]} -> **${change[1]}**`,
            `(${diff_str})`
        ].join(" ");
    }

    membership_change(date: Date, before: number, after: number): string {
        const month_idx = date.getMonth();
        const month = monthes[this.lang][month_idx]

        return [
            this.lang == "ru" ? "Членский взнос за " : "Membersheep for " + `${month}:`,
            `${before} -> ${after}`
        ].join(" ");
    }
}
