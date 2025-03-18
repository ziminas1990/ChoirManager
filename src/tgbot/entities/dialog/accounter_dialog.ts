import { Journal } from "../../journal.js";

import { Status, } from "../../../status.js";
import { Language, User } from "../../database.js";
import { UserLogic } from "../../logic/user.js";
import { Dialog } from "../../logic/dialog.js";
import { Formatter, GlobalFormatter, return_fail } from "../../utils.js";
import { Runtime } from "../../runtime.js";


export class AccounterDialog {
    private journal: Journal;
    private formatter: Formatter;

    constructor(private user: UserLogic, parent_journal: Journal, formatter?: Formatter) {
        this.journal = parent_journal.child("dialog.accounter");
        this.formatter = formatter ?? GlobalFormatter.instance();
    }

    async send_top_up_notification(
        userid: string, amount: number, original_message: string, dialog?: Dialog)
    : Promise<Status>
    {
        if (!dialog) {
            dialog = this.user.main_dialog();
            if (!dialog) {
                return return_fail(`no active dialog`, this.journal.log());
            }
        }

        const user = Runtime.get_instance().get_user(userid);
        if (!user) {
            return return_fail(`User ${userid} not found`, this.journal.log());
        }
        const message = this.top_up_notification(user.data.lang, user.data, amount, original_message);
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
        return await dialog.send_message(this.user_already_paid(user.data, dialog.user.data.lang));
    }

    async mirror_message(message: string, receiver?: User, dialog?: Dialog): Promise<Status> {
        if (!dialog) {
            dialog = this.user.main_dialog();
            if (!dialog) {
                return return_fail(`no active dialog`, this.journal.log());
            }
        }

        const prefix = receiver
            ? `Notification for ${receiver.name} ${receiver.surname} (@${receiver.tgid}):\n`
            : "Notification:\n";
        const full_message = [prefix, message].filter(line => line.trim().length > 0).join("\n");
        return await dialog.send_message(full_message);
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

    private top_up_notification(lang: Language, user: User, amount: number, original_message: string): string {
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
}