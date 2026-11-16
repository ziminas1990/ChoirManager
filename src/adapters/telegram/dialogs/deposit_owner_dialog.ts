import { IJournal } from "@src/interfaces/journal.js";
import { TelegramUser } from "@src/adapters/telegram/telegram_user.js";
import { current_month, Formatter, GlobalFormatter } from "@src/utils.js";
import { Status } from "@src/utils/expected.js";
import { Language, user_tg_username } from "@src/entities/user.js";
import { Deposit, DepositChange } from "@src/entities/deposit.js";
import { DepositPresentationConfig } from "@src/adapters/deposit_service/factory.js";
import { DepositActions } from "@src/use_cases/deposit_actions.js";
import { IDepositOwnerAgent, IUserAgent } from "@src/interfaces/user_agent.js";
import { Transaction } from "@src/interfaces/transactions_storage.js";
import { DepositTransactionsMessages } from "@src/utils/string_engine/deposit_transactions.js";
import { DepositTransactionsWidget } from "@src/adapters/telegram/widgets/deposit_transactions.js";


export class DepositOwnerDialog implements IDepositOwnerAgent {
    private journal: IJournal;
    private orator: Orator;

    constructor(
        private user: TelegramUser,
        parent_journal: IJournal,
        private readonly deposit_presentation?: DepositPresentationConfig,
        formatter?: Formatter)
    {
        this.journal = parent_journal.child("dialog.deposit_owner");
        this.orator = new Orator(
            formatter ?? GlobalFormatter.instance(), this.deposit_presentation);
    }

    base(): IUserAgent {
        return this.user;
    }

    async send_deposit_info(info: Deposit | undefined): Promise<Status> {
        const get_transactions_button = this.user.create_callback_button(
                this.orator.get_transactions_button(this.user.info().lang),
                `open transactions for ${user_tg_username(this.user.info())}`,
                async () => {
                    return await DepositActions.transactions_requested(
                        this.user, this.journal );
                }
            );

        const status = await this.user.send_message(this.orator.deposit_info(info, this.user.info().lang), {
            buttons: [[get_transactions_button]],
        });
        return status.as_status();
    }

    async send_transactions_info(transactions: Transaction[] | undefined): Promise<Status>
    {
        return await new DepositTransactionsWidget(this.user, transactions).start();
    }

    async send_deposit_changes(
        deposit: Deposit,
        changes: DepositChange,
        transactions: readonly Transaction[] | undefined,
    ): Promise<Status>
    {
        return (await this.user.send_message(
            this.orator.deposit_change(deposit, changes, this.user.info().lang, transactions)
        )).as_status();
    }

    async send_already_paid_response(): Promise<Status> {
        return (await this.user.send_message(
            this.orator.already_paid_response(this.user.info().lang)
        )).as_status();
    }

    async send_thanks_for_information(): Promise<Status> {
        return (await this.user.send_message(
            this.orator.thanks_for_information(this.user.info().lang)
        )).as_status();
    }

    async send_membership_reminder(amount: number): Promise<Status> {
        const message = [
            this.orator.deposit_reminder(amount, this.user.info().lang),
            "",
            this.orator.account_info(this.user.info().lang)
        ].join("<br>");


        const have_paid_botton = this.user.create_callback_button(
            this.orator.have_paid_already(this.user.info().lang),
            `already paid by @${user_tg_username(this.user.info())}`,
            async () => {
                return await DepositActions.already_paid(this.user, this.journal);
            }
        );

        const status = await this.user.send_message(message, {
            buttons: [[have_paid_botton]],
        });

        return status.as_status();
    }
}

const monthes: {[key in Language]: string[]} = {
    "ru": ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
           "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"],
    "en": ["January", "February", "March", "April", "May", "June",
           "July", "August", "September", "October", "November", "December"]
}

export class Orator {
    constructor(
        private formatter: Formatter,
        private readonly deposit_presentation?: DepositPresentationConfig,
    ) {}

    deposit_change(
        deposit: Deposit, change: DepositChange, lang: Language,
        transactions: readonly Transaction[] | undefined,
    ): string {
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

        const waiting_membership = this.waiting_membership(deposit, lang);
        if (waiting_membership) {
            lines.push("");
            lines.push(waiting_membership);
        }
        lines.push(DepositTransactionsMessages.recent(transactions, lang));

        return lines.join("<br>")
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
            lang == Language.RU ? "Информация о твоём депозите:" : "Your deposit:",
            "",
            this.balance(deposit.balance, lang)
        ];

        const this_month = current_month();
        const month = monthes[lang][this_month.getMonth()];
        const paid = deposit.membership.get(this_month.getTime()) ?? 0;

        lines.push((lang == Language.RU ? "Внесено за" : "Paid for") + ` ${month}: ${paid} GEL`)
        lines.push("")
        lines.push(this.waiting_membership(deposit, lang));
        return lines.join("<br>")
    }

    waiting_membership(deposit: Deposit, lang: Language): string {
        if (!this.deposit_presentation) {
            return "";
        }

        const this_month = current_month();
        const month = monthes[lang][this_month.getMonth()];
        const paid = deposit.membership.get(this_month.getTime()) ?? 0;

        const total = paid + deposit.balance;
        const membership_fee = this.deposit_presentation.membership_fee;

        if (total < membership_fee) {
            const diff = membership_fee - total;
            if (lang == Language.RU) {
                return [
                    `За ${month} нужно внести ещё ${diff} GEL`,
                    "",
                    this.account_info(lang)
                ].join("<br>");
            } else {
                return [
                    `You are expected to pay another ${diff} GEL for ${month}`,
                    "",
                    this.account_info(lang)
                ].join("<br>");
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
        if (!this.deposit_presentation || this.deposit_presentation.accounts.length === 0) {
            return "";
        }

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

        for (const account of this.deposit_presentation.accounts) {
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

        return lines.join("<br>");
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
