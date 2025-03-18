import TelegramBot from "node-telegram-bot-api";
import { Journal } from "../../journal.js";

import { Status, StatusWith } from "../../../status.js";
import { Language } from "../../database.js";
import { Deposit, DepositChange } from "../../fetchers/deposits_fetcher.js";
import { UserLogic } from "../../logic/user.js";
import { Dialog } from "../../logic/dialog.js";
import { current_month, Formatter, GlobalFormatter, return_exception, return_fail } from "../../utils.js";
import { Config } from "../../config.js";
import { BotAPI } from "../../api/telegram.js";
import { Runtime } from "../../runtime.js";
import { DepositActions } from "../../use_cases/deposit_actions.js";


export class DepositOwnerDialog {
    private journal: Journal;
    private orator: Orator;

    constructor(private user: UserLogic, parent_journal: Journal, formatter?: Formatter) {
        this.journal = parent_journal.child("dialog.deposit_owner");
        this.orator = new Orator(formatter ?? GlobalFormatter.instance());
    }

    async send_deposit_info(info: Deposit | undefined, dialog?: Dialog): Promise<Status> {
        if (!dialog) {
            dialog = this.user.main_dialog();
            if (!dialog) {
                return return_fail(`no active dialog`, this.journal.log());
            }
        }
        return await dialog.send_message(this.orator.deposit_info(info, dialog.user.data.lang));
    }

    async on_deposit_change(deposit: Deposit, changes: DepositChange, dialog?: Dialog)
    : Promise<StatusWith<string>>
    {
        if (!dialog) {
            dialog = this.user.main_dialog();
            if (!dialog) {
                return return_fail(`no active dialog`, this.journal.log());
            }
        }
        const message = this.orator.deposit_change(deposit, changes, dialog.user.data.lang);
        const status = await dialog.send_message(message);
        return status.with(message);
    }

    async send_already_paid_response(dialog?: Dialog): Promise<Status> {
        if (!dialog) {
            dialog = this.user.main_dialog();
            if (!dialog) {
                return return_fail(`no active dialog`, this.journal.log());
            }
        }
        return await dialog.send_message(this.orator.already_paid_response(this.user.data.lang));
    }

    async send_thanks_for_information(dialog?: Dialog): Promise<Status> {
        if (!dialog) {
            dialog = this.user.main_dialog();
            if (!dialog) {
                return return_fail(`no active dialog`, this.journal.log());
            }
        }
        return await dialog.send_message(this.orator.thanks_for_information(this.user.data.lang));
    }

    async send_reminder(amount: number, dialog?: Dialog): Promise<StatusWith<string>> {
        if (!dialog) {
            dialog = this.user.main_dialog();
            if (!dialog) {
                return return_fail(`no active dialog`, this.journal.log());
            }
        }

        const message = [
            this.orator.deposit_reminder(amount, dialog.user.data.lang),
            "",
            this.orator.account_info(dialog.user.data.lang)
        ].join("\n");

        const callbacks = dialog.user.callbacks_registry();

        const callback_params = { dialog };
        const have_paid_callback_id = callbacks.add_callback({
            fn: async () => {
                return await DepositActions.already_paid(
                    Runtime.get_instance(),
                    dialog.user.data.tgid,
                    this.journal,);
            },
            journal: this.journal.child("callback"),
            params: callback_params,
            debug_name: `already paid by @${dialog.user.data.tgid}`,
            single_shot: true
        });

        const keyboard: TelegramBot.InlineKeyboardMarkup = {
            inline_keyboard: [
                [{
                    text: this.orator.have_paid_already(dialog.user.data.lang),
                    callback_data: have_paid_callback_id
                }]
            ]
        };

        try {
            await BotAPI.instance().sendMessage(
                dialog.chat_id,
                message,
                {
                    reply_markup: keyboard,
                    parse_mode: "HTML"
                });
            return Status.ok().with(message);
        } catch (err) {
            return return_exception(err, this.journal.log());
        }
    }
}

const monthes: {[key in Language]: string[]} = {
    "ru": ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
           "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"],
    "en": ["January", "February", "March", "April", "May", "June",
           "July", "August", "September", "October", "November", "December"]
}

class Orator {
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
