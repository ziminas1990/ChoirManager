import TelegramBot from "node-telegram-bot-api";
import { Journal } from "../journal.js";

import { Status } from "../../status.js";
import { Language } from "../database.js";
import { Deposit, DepositChange } from "../fetchers/deposits_fetcher.js";
import { DepositsTrackerEvent } from "../logic/deposits_tracker.js";
import { BaseActivity } from "./base_activity.js";
import { UserLogic } from "../logic/user.js";
import { Dialog } from "../logic/dialog.js";
import { current_month, Formatter, GlobalFormatter } from "../utils.js";
import { Config } from "../config.js";


export class DepositActivity extends BaseActivity {
    private journal: Journal;

    constructor(parent_journal: Journal) {
        super();
        this.journal = parent_journal.child("deposit_activity");
        if (!Messages.formatter) {
            Messages.formatter = GlobalFormatter.instance();
        }
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
        switch (event.what) {
            case "update":
                return await this.handle_update_event(event.deposit, event.changes, dialog);
            case "reminder":
                return await this.handle_reminder_event(event.amount, dialog);
            default:
                return Status.fail(`Unknown event type: ${(event as any).what}`);
        }
    }

    private async handle_update_event(deposit: Deposit, changes: DepositChange, dialog: Dialog): Promise<Status> {
        const message = Messages.deposit_change(deposit, changes, dialog.user.data.lang);
        const status = await dialog.send_message(message);
        if (status.ok()) {
            await this.notify_accountants(dialog, message);
        }
        return status;
    }

    private async handle_reminder_event(amount: number, dialog: Dialog): Promise<Status> {
        if (!dialog.user.is_chorister() || dialog.user.is_ex_chorister()) {
            return Status.ok();
        }
        if (amount < 10) {
            // It's okay to move it to the next month
            return Status.ok();
        }

        const message = [
            Messages.deposit_reminder(amount, dialog.user.data.lang),
            "",
            Messages.account_info(dialog.user.data.lang)
        ].join("\n");
        const status = await dialog.send_message(message);
        if (status.ok()) {
            await this.notify_accountants(dialog, message);
        }
        return status;
    }

    async notify_accountants(user_dialog: Dialog, message: string) {
        const who = user_dialog.user.data;
        for (const accountant of DepositActivity.accountants) {
            const dialog = accountant.main_dialog();
            if (dialog) {
                const status = await dialog.send_message(
                    `Notification for ${who.name} ${who.surname} (@${who.tgid}):\n\n${message}`);
                if (!status.ok()) {
                    this.journal.log().warn(`failed to send notification to (@${accountant.data.tgid}): ${status.what()}`);
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

    static formatter: Formatter;

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

        const this_month = current_month();
        const month = monthes[lang][this_month.getMonth()];
        const paid = deposit.membership.get(this_month.getTime()) ?? 0;

        lines.push((lang == Language.RU ? "Внесено за" : "Paid for") + ` ${month}: ${paid} GEL`)
        lines.push("")
        lines.push(Messages.waiting_membership(deposit, lang));
        return lines.join("\n")
    }

    static waiting_membership(deposit: Deposit, lang: Language): string {
        const this_month = current_month();
        const month = monthes[lang][this_month.getMonth()];
        const paid = deposit.membership.get(this_month.getTime()) ?? 0;

        const total = paid + deposit.balance;
        const membership_fee = Config.DepositTracker().membership_fee;

        if (total < membership_fee) {
            const diff = membership_fee - total;
            if (lang == Language.RU) {
                return [
                    `За ${month} нужно внести ещё ${diff} GEL`,
                    "",
                    Messages.account_info(lang)
                ].join("\n");
            } else {
                return [
                    `You are expected to pay another ${diff} GEL for ${month}`,
                    "",
                    Messages.account_info(lang)
                ].join("\n");
            }
        }

        if (lang == Language.RU) {
            return `За ${month} ничего платить не нужно`;
        } else {
            return `Membership fee for ${month} is paid `;
        }
    }

    static deposit_reminder(amount: number, lang: Language): string {
        switch (lang) {
            case Language.RU:
                return `Привет! Напоминаню что в этом месяце нужно внести ещё ${amount} GEL в качестве членского взноса.`;
            case Language.EN:
            default:
                return `Hi! Just a reminder that this month you need to deposit another ${amount} GEL as a membership fee.`;
        }
    }

    static account_info(lang: Language): string {
        const lines: string[] = [];

        const langs: {[key in Language]: {title: string, account: string, receiver: string}} = {
            "ru": {
                title: "Начислить членский взнос можно по следующим реквизитам:",
                account: "Счёт",
                receiver: "Получатель",
            },
            "en": {
                title: "You can deposit membership fee by the following account(s):",
                account: "Account",
                receiver: "Receiver",
            }
        };
        const words = langs[lang] ?? langs["en"];

        lines.push(words.title);
        lines.push("");

        for (const account of Config.DepositTracker().accounts) {
            lines.push(this.formatter.bold(account.title) + ":");
            lines.push(`${words.account}: ${this.formatter.copiable(account.account)}`)
            if (account.receiver) {
                lines.push(`${words.receiver}: ${this.formatter.copiable(account.receiver)}`)
            }
            if (account.comment) {
                lines.push(Messages.formatter.italic(`(${account.comment})`))
            }
            lines.push("");
        }

        return lines.join("\n");
    }
}
