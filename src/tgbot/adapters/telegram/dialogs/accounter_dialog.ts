import { Status } from "@src/status.js";
import { TelegramUser } from "@src/tgbot/adapters/telegram/telegram_user.js";
import { Formatter, GlobalFormatter } from "@src/tgbot/utils.js";
import { Language, User } from "@src/tgbot/database.js";
import { Deposit, DepositChange } from "@src/tgbot/fetchers/deposits_fetcher.js";
import { Orator } from "./deposit_owner_dialog.js";

export class AccounterDialog {
    private formatter: Formatter;

    constructor(
        private user: TelegramUser,
        formatter?: Formatter)
    {
        this.formatter = formatter ?? GlobalFormatter.instance();
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

    private user_already_paid(user: User, lang: Language): string {
        const name = `${user.name} ${user.surname ?? ""} (@${user.tgid})`;
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
                lines.push(`${name} says deposited ${amount} GEL`);
                break;
        }

        lines.push("");
        lines.push(this.formatter.quote(original_message));
        return lines.join("\n");
    }

    async mirror_deposit_changes(who: User, deposit: Deposit, changes: DepositChange): Promise<Status> {
        const orator = new Orator(this.formatter);
        const changes_msg = orator.deposit_change(deposit, changes, this.user.info().lang);
        const who_msg = `Notification for ${who.name} ${who.surname} (@${who.tgid}):\n`;
        const message = [who_msg, changes_msg].join("\n");
        return await this.user.send_message(message);
    }
}