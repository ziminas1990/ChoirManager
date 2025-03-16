import TelegramBot from "node-telegram-bot-api";
import { Journal } from "../journal.js";

import { Status } from "../../status.js";
import { Language, User } from "../database.js";
import { Deposit, DepositChange } from "../fetchers/deposits_fetcher.js";
import { DepositsTrackerEvent } from "../logic/deposits_tracker.js";
import { BaseActivity } from "./base_activity.js";
import { UserLogic } from "../logic/user.js";
import { Dialog } from "../logic/dialog.js";
import { current_month, Formatter, GlobalFormatter, return_exception, return_fail } from "../utils.js";
import { Config } from "../config.js";
import { BotAPI } from "../api/telegram.js";
import { Runtime } from "../runtime.js";
import { DepositActions } from "../use_cases/deposit_actions.js";


export class DepositActivity extends BaseActivity {
    // To duplicate all notifications to them
    // TODO: get rid of this
    static accountants: UserLogic[] = []

    private journal: Journal;

    constructor(private user: UserLogic, parent_journal: Journal) {
        super();
        this.journal = parent_journal.child("deposit_activity");
        if (!Messages.formatter) {
            Messages.formatter = GlobalFormatter.instance();
        }
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

    async send_deposit_info(info: Deposit, dialog: Dialog): Promise<Status> {
        return await dialog.send_message(Messages.deposit_info(info, dialog.user.data.lang));
    }

    async on_deposit_event(event: DepositsTrackerEvent, dialog: Dialog): Promise<Status> {
        this.journal.log().info({ event }, `got event`);
        switch (event.what) {
            case "update":
                return await this.handle_update_event(event.deposit, event.changes, dialog);
            case "reminder":
                return await this.handle_reminder_event(event.amount, dialog);
            default:
                return Status.fail(`Unknown event type: ${(event as any).what}`);
        }
    }

    async send_top_up_notification(userid: string, amount: number, original_message: string)
    : Promise<Status>
    {
        const dialog = this.user.main_dialog();
        if (!dialog) {
            return return_fail(`no active dialog`, this.journal.log());
        }

        const user = Runtime.get_instance().get_user(userid);
        if (!user) {
            return return_fail(`User ${userid} not found`, this.journal.log());
        }
        const message = Messages.top_up_notification(user.data.lang, user.data, amount, original_message);
        return await dialog.send_message(message);
    }

    async send_already_paid_notification(userid: string, dialog?: Dialog): Promise<Status> {
        if (!dialog) {
            dialog = this.user.main_dialog();
        }
        if (!dialog) {
            return return_fail(`no active dialog`, this.journal.log());
        }
        const user = Runtime.get_instance().get_user(userid);
        if (!user) {
            return return_fail(`user ${userid} not found`, this.journal.log());
        }
        return await dialog.send_message(Messages.user_already_paid(user.data, dialog.user.data.lang));
    }

    async send_already_paid_response(): Promise<Status> {
        const dialog = this.user.main_dialog();
        if (!dialog) {
            return return_fail(`no active dialog`, this.journal.log());
        }
        return await dialog.send_message(Messages.already_paid_response(this.user.data.lang));
    }

    async send_thanks_for_information(): Promise<Status> {
        const dialog = this.user.main_dialog();
        if (!dialog) {
            return return_fail(`no active dialog`, this.journal.log());
        }
        return await dialog.send_message(Messages.thanks_for_information(this.user.data.lang));
    }

    private async handle_update_event(deposit: Deposit, changes: DepositChange, dialog: Dialog): Promise<Status> {
        const message = Messages.deposit_change(deposit, changes, dialog.user.data.lang);
        const status = await dialog.send_message(message);
        if (status.ok()) {
            await this.notify_accountants(message, dialog.user.data);
        }
        return status;
    }

    private async handle_reminder_event(amount: number, dialog: Dialog): Promise<Status> {
        if (!dialog.user.is_chorister() || dialog.user.is_ex_chorister()) {
            this.journal.log().info(`skipping reminder for ${dialog.user.data.tgid} because they are not chorister`);
            return Status.ok();
        }
        if (amount < 10) {
            this.journal.log().info(`skipping reminder for ${dialog.user.data.tgid} because amount is too small: ${amount}`);
            // It's okay to move it to the next month
            return Status.ok();
        }

        const message = [
            Messages.deposit_reminder(amount, dialog.user.data.lang),
            "",
            Messages.account_info(dialog.user.data.lang)
        ].join("\n");

        const callbacks = dialog.user.callbacks_registry();

        const callback_params = { dialog };
        const have_paid_callback_id = callbacks.add_callback({
            fn: async () => {
                return await DepositActions.already_paid(
                    Runtime.get_instance(), dialog.user.data.tgid, this.journal);
            },
            journal: this.journal.child("callback"),
            params: callback_params,
            debug_name: `already paid by @${dialog.user.data.tgid}`,
            single_shot: true
        });

        const keyboard: TelegramBot.InlineKeyboardMarkup = {
            inline_keyboard: [
                [{
                    text: Messages.have_paid_already(dialog.user.data.lang),
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
            await this.notify_accountants(message, dialog.user.data);
        } catch (err) {
            return return_exception(err, this.journal.log());
        }

        return Status.ok();
    }

    async notify_accountants(message: string, who?: User) {
        const prefix = who ? `Notification for ${who.name} ${who.surname} (@${who.tgid}):\n` : "";
        const full_message = [prefix, message].filter(line => line.trim().length > 0).join("\n");

        for (const accountant of DepositActivity.accountants) {
            const dialog = accountant.main_dialog();
            if (dialog) {
                const status = await dialog.send_message(full_message);
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
        lines.push(this.formatter.bold(Messages.deposit_changes_test(change.total_change, lang)));
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

    static deposit_changes_test(amount: number, lang: Language): string {
        let message = lang == Language.RU ? "Изменения на твоём депозите" : "Deposit changes"
        if (amount != 0) {
            message += ": " + Messages.amount_changed(amount, lang);
        }
        return message;
    }

    static credited(amount: number, lang: Language): string {
        return lang == Language.RU ? `начислено ${amount} GEL` : `credited ${amount} GEL`;
    }

    static withdrawn(amount: number, lang: Language): string {
        return lang == Language.RU ? `списано ${amount} GEL` : `withdrawn ${amount} GEL`;
    }

    static amount_changed(amount: number, lang: Language): string {
        return amount > 0 ? Messages.credited(amount, lang) : Messages.withdrawn(-amount, lang);
    }

    static balance(amount: number, lang: Language): string {
        return (lang == Language.RU ? "Средств на депозите:" : "Funds on deposit:") + ` ${amount} GEL`;
    }

    static balance_changed(change: [number, number], lang: Language): string {
        const diff = change[1] - change[0];
        const diff_str = Messages.amount_changed(diff, lang);

        return [
            lang == Language.RU ? "Средств на депозите:" : "Funds on deposit:",
            `${change[0]} -> ${change[1]}`,
            `(${diff_str})`
        ].join(" ");
    }

    static membership_change(date: Date, before: number, after: number, lang: Language): string {
        const month = monthes[lang][date.getMonth()]

        const diff = after - before;
        const diff_str = Messages.amount_changed(diff, lang);

        return [
            lang == Language.RU ? "Членский взнос за" : "Membership for",
            `${month}: ${before} -> ${after}`,
            `(${diff_str})`
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
                return `Привет! Напоминаю что в этом месяце нужно внести ещё ${amount} GEL в качестве членского взноса.`;
            case Language.EN:
            default:
                return `Hi! Just a reminder that this month you need to deposit another ${amount} GEL as a membership fee.`;
        }
    }

    static account_info(lang: Language): string {
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
                lines.push(Messages.formatter.italic(`(${account.comment})`))
            }
            lines.push("");
        }

        return lines.join("\n");
    }

    static have_paid_already(lang: Language): string {
        return lang == Language.RU ? "Я уже платил 🤷" : "I have paid already 🤷";
    }

    static already_paid_response(lang: Language): string {
        return lang == Language.RU ?
            "Упс, наверное не заметили. Попрошу проверить." :
            "Oops, probably they missed it. Will ask them to check.";
    }

    static user_already_paid(user: User, lang: Language): string {
        const name = `${user.name} ${user.surname ?? ""} (@${user.tgid})`;
        switch (lang) {
            case Language.RU:
                return `${name} говорит что уже оплатил членский взнос`;
            case Language.EN:
            default:
                return `${name} says that membership fee is already paid`;
        }
    }

    static top_up_notification(lang: Language, user: User, amount: number, original_message: string): string {
        const name = `${user.name} ${user.surname ?? ""} (@${user.tgid})`;
        const lines: string[] = [];
        switch (lang) {
            case Language.RU:
                lines.push(`${name} говорит что внёс ${amount} GEL на депозит`);
                break;
            case Language.EN:
            default:
                lines.push(`${name} says deposited ${amount} GEL`);
                break;
        }

        lines.push("");
        lines.push(Messages.formatter.quote(original_message));
        return lines.join("\n");
    }

    static thanks_for_information(lang: Language): string {
        switch (lang) {
            case Language.RU:
                return "Спасибо за информацию! Я передам её ответственному.";
            case Language.EN:
            default:
                return "Thank you for the information! I will pass it to the responsible person.";
        }
    }
}
