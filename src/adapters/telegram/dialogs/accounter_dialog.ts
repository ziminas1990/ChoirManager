import { Status } from "@src/status.js";
import { TelegramUser } from "@src/adapters/telegram/telegram_user.js";
import { Formatter, GlobalFormatter } from "@src/utils.js";
import { Language, User } from "@src/database.js";
import { Deposit, DepositChange } from "@src/fetchers/deposits_fetcher.js";
import { Orator } from "./deposit_owner_dialog.js";
import { IAccounterAgent, IUserAgent } from "@src/interfaces/user_agent.js";

export class AccounterDialog implements IAccounterAgent {
    private formatter: Formatter;

    constructor(
        private user: TelegramUser,
        formatter?: Formatter)
    {
        this.formatter = formatter ?? GlobalFormatter.instance();
    }

    base(): IUserAgent {
        return this.user;
    }

    async send_top_up_notification(who: User, amount: number, original_message: string)
    : Promise<Status>
    {
        return await this.user.send_message(
            this.top_up_notification(who, amount, original_message, this.user.info().lang)
        );
    }

    async send_already_paid_notification(who: User): Promise<Status> {
        return await this.user.send_message(
            this.user_already_paid(who, this.user.info().lang)
        );
    }

    async mirror_message(message: string, receiver?: User): Promise<Status> {
        const prefix = receiver
            ? `Notification for ${receiver.name} ${receiver.surname} (@${receiver.tgid}):\n`
            : "Notification:\n";
        const full_message = [prefix, message].filter(line => line.trim().length > 0).join("\n");
        return await this.user.send_message(full_message);
    }

    async mirror_deposit_changes(who: User, deposit: Deposit, changes: DepositChange): Promise<Status> {
        const orator = new Orator(this.formatter);
        const changes_msg = orator.deposit_change(deposit, changes, this.user.info().lang);
        const who_msg = `Notification for ${who.name} ${who.surname} (@${who.tgid}):\n`;
        const message = [who_msg, changes_msg].join("\n");
        return await this.user.send_message(message);
    }

    async mirror_reminder(who: User, amount: number): Promise<Status> {
        const lang = this.user.info().lang;
        return await this.user.send_message(this.mirrored_reminder(who, amount, lang));
    }

    private user_already_paid(who: User, lang: Language): string {
        const name = `${who.name} ${who.surname ?? ""} (@${who.tgid})`;
        switch (lang) {
            case Language.RU:
                return `${name} говорит что уже оплатил членский взнос`;
            case Language.EN:
            default:
                return `${name} says that membership fee is already paid`;
        }
    }

    private top_up_notification(
        user: User, amount: number, original_message: string, lang: Language)
    : string
    {
        const name = `${user.name} ${user.surname ?? ""} (@${user.tgid})`;
        const lines: string[] = [];
        switch (lang) {
            case Language.RU:
                lines.push(`${name} говорит что внёс ${amount} GEL на депозит`);
                break;
            case Language.EN:
            default:
                lines.push(`${name} says that they deposited ${amount} GEL`);
                break;
        }

        lines.push("");
        lines.push(this.formatter.quote(original_message));
        return lines.join("\n");
    }

    private mirrored_reminder(who: User, amount: number, lang: Language): string {
        const name = `${who.name} ${who.surname ?? ""} (@${who.tgid})`;
        const message: string[] = []

        switch (lang) {
            case Language.RU:
                message.push(...[
                    this.formatter.bold("Отправлено напоминание:"),
                    "",
                    `Пользователь ${name} должен внести ещё ${amount} GEL`,
                ])
                break;
            case Language.EN:
            default:
                message.push(...[
                    this.formatter.bold("Reminder sent:"),
                    "",
                    `User ${name} should deposit another ${amount} GEL`,
                ]);
                break;
        }
        return message.join("\n");
    }
}