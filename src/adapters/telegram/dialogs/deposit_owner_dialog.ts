import TelegramBot from "node-telegram-bot-api";

import { Journal } from "@src/journal.js";
import { TelegramUser } from "@src/adapters/telegram/telegram_user.js";
import { current_month, Formatter, GlobalFormatter } from "@src/utils.js";
import { Status } from "@src/status.js";
import { Language } from "@src/database.js";
import { Deposit, DepositChange } from "@src/fetchers/deposits_fetcher.js";
import { DepositActions } from "@src/use_cases/deposit_actions.js";
import { Config } from "@src/config.js";
import { IDepositOwnerAgent, IUserAgent } from "@src/interfaces/user_agent.js";

import { Transaction } from "@src/interfaces/transactions_storage.js";


export class DepositOwnerDialog implements IDepositOwnerAgent {
    private journal: Journal;
    private orator: Orator;

    constructor(
        private user: TelegramUser,
        parent_journal: Journal,
        formatter?: Formatter)
    {
        this.journal = parent_journal.child("dialog.deposit_owner");
        this.orator = new Orator(formatter ?? GlobalFormatter.instance());
    }

    base(): IUserAgent {
        return this.user;
    }

    async send_deposit_info(info: Deposit | undefined): Promise<Status> {
        
        const get_transactions_button = this.user.create_keyboard_button(
                this.orator.get_transactions_button(this.user.info().lang),
                `open transactions for ${this.user.userid()}`,
                async () => {
                    return await DepositActions.transactions_requested(this.user, this.journal);
                }
            );

        const keyboard: TelegramBot.InlineKeyboardMarkup = {
            inline_keyboard: [
                [get_transactions_button]
            ]
        };

        return await this.user.send_message(
            this.orator.deposit_info(info, this.user.info().lang),{
                reply_markup: keyboard
            });
    }

    async send_transactions_info(transactions: Transaction[] | undefined): Promise<Status> {
        return await this.user.send_message(
            this.orator.transactions_info(transactions, this.user.info().lang));
    }

    async send_deposit_changes(deposit: Deposit, changes: DepositChange) : Promise<Status>
    {
        return await this.user.send_message(
            this.orator.deposit_change(deposit, changes, this.user.info().lang)
        );
    }

    async send_already_paid_response(): Promise<Status> {
        return await this.user.send_message(
            this.orator.already_paid_response(this.user.info().lang)
        );
    }

    async send_thanks_for_information(): Promise<Status> {
        return await this.user.send_message(
            this.orator.thanks_for_information(this.user.info().lang)
        );
    }

    async send_membership_reminder(amount: number): Promise<Status> {
        const message = [
            this.orator.deposit_reminder(amount, this.user.info().lang),
            "",
            this.orator.account_info(this.user.info().lang)
        ].join("\n");


        const have_paid_botton = this.user.create_keyboard_button(
            this.orator.have_paid_already(this.user.info().lang),
            `already paid by @${this.user.info().tgid}`,
            async () => {
                return await DepositActions.already_paid(this.user, this.journal);
            }
        );

        const keyboard: TelegramBot.InlineKeyboardMarkup = {
            inline_keyboard: [
                [have_paid_botton]
            ]
        };

        try {
            await this.user.send_message(
                message,
                {
                    reply_markup: keyboard,
                    parse_mode: "HTML"
                });
            return Status.ok();
        } catch (err) {
            return Status.exception(err);
        }
    }
}

const monthes: {[key in Language]: string[]} = {
    "ru": ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
           "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"],
    "en": ["January", "February", "March", "April", "May", "June",
           "July", "August", "September", "October", "November", "December"]
}

export class Orator {
    constructor(private formatter: Formatter) {}

    deposit_change(deposit: Deposit, change: DepositChange, lang: Language): string {
        const lines: string[] = [];
        lines.push(this.formatter.bold(this.deposit_changes_test(change.total_change, lang)));
        lines.push("");

        if (change.balance) {
            lines.push(this.balance_changed(change.balance, lang))
        } else {
            lines.push(this.balance(deposit.balance, lang));
        }

        for (const membership_change of change.membership ?? []) {
            const [date, before, after] = membership_change;
            lines.push(this.membership_change(date, before, after, lang));
        }

        lines.push("");
        lines.push(this.waiting_membership(deposit, lang));

        return lines.join("\n")
    }

    deposit_changes_test(amount: number, lang: Language): string {
        let message = lang == Language.RU ? "Изменения на твоём депозите" : "Deposit changes"
        if (amount != 0) {
            message += ": " + this.amount_changed(amount, lang);
        }
        return message;
    }

    credited(amount: number, lang: Language): string {
        return lang == Language.RU ? `начислено ${amount} GEL` : `credited ${amount} GEL`;
    }

    withdrawn(amount: number, lang: Language): string {
        return lang == Language.RU ? `списано ${amount} GEL` : `withdrawn ${amount} GEL`;
    }

    amount_changed(amount: number, lang: Language): string {
        return amount > 0 ? this.credited(amount, lang) : this.withdrawn(-amount, lang);
    }

    balance(amount: number, lang: Language): string {
        return (lang == Language.RU ? "Средств на депозите:" : "Funds on deposit:") + ` ${amount} GEL`;
    }

    balance_changed(change: [number, number], lang: Language): string {
        const diff = change[1] - change[0];
        const diff_str = this.amount_changed(diff, lang);

        return [
            lang == Language.RU ? "Средств на депозите:" : "Funds on deposit:",
            `${change[0]} -> ${change[1]}`,
            `(${diff_str})`
        ].join(" ");
    }

    membership_change(date: Date, before: number, after: number, lang: Language): string {
        const month = monthes[lang][date.getMonth()]

        const diff = after - before;
        const diff_str = this.amount_changed(diff, lang);

        return [
            lang == Language.RU ? "Членский взнос за" : "Membership for",
            `${month}: ${before} -> ${after}`,
            `(${diff_str})`
        ].join(" ");
    }

    deposit_info(deposit: Deposit | undefined, lang: Language): string {
        if (!deposit) {
            return lang == Language.RU ? "Нет информации о твоём депозите"
                                       : "No deposit info available";
        }

        const lines = [
            lang == Language.RU ? "Информация о твоём депозите:" : "You deposit:",
            "",
            this.balance(deposit.balance, lang)
        ];

        const this_month = current_month();
        const month = monthes[lang][this_month.getMonth()];
        const paid = deposit.membership.get(this_month.getTime()) ?? 0;

        lines.push((lang == Language.RU ? "Внесено за" : "Paid for") + ` ${month}: ${paid} GEL`)
        lines.push("")
        lines.push(this.waiting_membership(deposit, lang));
        return lines.join("\n")
    }

    transactions_info(transactions: Transaction[] | undefined, lang: Language): string {
        if (!transactions || transactions.length == 0) {
            return lang == Language.RU 
            ? "Нет транзакций для твоего депозита." 
            : "No transactions found for your deposit.";
        }
        
        const lines: string[] = [];
        lines.push(lang == Language.RU ? "Список транзакций:" : "List of transactions:");
        const currency = lang == Language.RU ? "лар" : "GEL";
        for (const tx of transactions) {
            const d = coerceToDate(tx.date);
            const dateStr = d ? d.toISOString().slice(0, 10) : "<invalid-date>";
            const amountStr = Number.isFinite(tx.change) 
                ? (tx.change as number).toFixed(2) 
                : String(tx.change);
            const action = tx.change > 0 
            ? lang == Language.RU ? "Пополнение" : "Replenishment"
            : lang == Language.RU ? "Списание"   : "Withdrawal";
            const balanceStr = Language.RU ? "Баланс после" : "Balance after";
            lines.push(`${action} ${dateStr}: ${amountStr} ${currency} (${balanceStr}: ${tx.balance_after})`);
        }

        return lines.join("\n");
    }

    waiting_membership(deposit: Deposit, lang: Language): string {
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
                    this.account_info(lang)
                ].join("\n");
            } else {
                return [
                    `You are expected to pay another ${diff} GEL for ${month}`,
                    "",
                    this.account_info(lang)
                ].join("\n");
            }
        }

        if (lang == Language.RU) {
            return `За ${month} ничего платить не нужно`;
        } else {
            return `Membership fee for ${month} is paid `;
        }
    }

    deposit_reminder(amount: number, lang: Language): string {
        switch (lang) {
            case Language.RU:
                return `Привет! Напоминаю что в этом месяце нужно внести ещё ${amount} GEL в качестве членского взноса.`;
            case Language.EN:
            default:
                return `Hi! Just a reminder that this month you need to deposit another ${amount} GEL as a membership fee.`;
        }
    }

    account_info(lang: Language): string {
        const lines: string[] = [];

        const langs: {[key in Language]: {title: string, account: string, receiver: string}} = {
            "ru": {
                title: "Перечислить членский взнос можно по следующим реквизитам (тапни чтобы скопировать):",
                account: "Счёт",
                receiver: "Получатель",
            },
            "en": {
                title: "The membership fee can be transferred to the following details (tap to copy):",
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
                lines.push(this.formatter.italic(`(${account.comment})`))
            }
            lines.push("");
        }

        return lines.join("\n");
    }

    have_paid_already(lang: Language): string {
        return lang == Language.RU ? "Я уже платил 🤷" : "I have paid already 🤷";
    }

    get_transactions_button(lang: Language): string {
        switch (lang) {
            case Language.RU: return "Транзакции";
            case Language.EN:
            default:
                return "Transactions";
        }
    }

    already_paid_response(lang: Language): string {
        return lang == Language.RU ?
            "Упс, наверное не заметили. Попрошу проверить." :
            "Oops, probably they missed it. Will ask them to check.";
    }

    thanks_for_information(lang: Language): string {
        switch (lang) {
            case Language.RU:
                return "Спасибо за информацию! Передал её оргам.";
            case Language.EN:
            default:
                return "Thank you for the information! Passed it to the responsible person.";
        }
    }
}

function coerceToDate(input: any): Date | null {
    if (input instanceof Date && !isNaN(input.getTime())) {
        return input;
    }

    if (input && typeof input.toDate === "function") {
        const d = input.toDate();
        return isNaN(d.getTime()) ? null : d;
    }

    if (typeof input === "number") {
        const ms = input > 1e12 ? input : input * 1000;
        const d = new Date(ms);
        return isNaN(d.getTime()) ? null : d;
    }

    if (typeof input === "string") {
        const d = new Date(input);
        return isNaN(d.getTime()) ? null : d;
    }

    if (input && typeof input === "object") {
        if (typeof input.seconds === "number") {
            const ms = input.seconds * 1000 + (input.nanoseconds ? Math.floor(input.nanoseconds / 1e6) : 0);
            const d = new Date(ms);
            return isNaN(d.getTime()) ? null : d;
        }
        if (typeof input._seconds === "number") {
            const ms = input._seconds * 1000 + (input._nanoseconds ? Math.floor(input._nanoseconds / 1e6) : 0);
            const d = new Date(ms);
            return isNaN(d.getTime()) ? null : d;
        }
    }

    return null;
}


