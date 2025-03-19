import fs from "fs";

import { Journal } from "../../journal.js";
import { Status, } from "../../../status.js";
import { UserLogic } from "../../logic/user.js";
import { Dialog } from "../../logic/dialog.js";
import { Formatter, GlobalFormatter, return_exception, return_fail } from "../../utils.js";
import { BotAPI } from "../../api/telegram.js";


export class AdminDialog {
    private journal: Journal;
    private formatter: Formatter;

    constructor(private user: UserLogic, parent_journal: Journal, formatter?: Formatter) {
        this.journal = parent_journal.child("dialog.admin");
        this.formatter = formatter ?? GlobalFormatter.instance();
        this.formatter.do_nothing();
    }

    async send_notification(message: string, dialog?: Dialog)
    : Promise<Status>
    {
        if (!dialog) {
            dialog = this.user.main_dialog();
            if (!dialog) {
                return return_fail(`no active dialog`, this.journal.log());
            }
        }
        return await dialog.send_message([
            this.formatter.bold("Admin's notification:"),
            message,
        ].join("\n"));
    }

    async send_file(filename: string, dialog?: Dialog)
    : Promise<Status>
    {
        if (!dialog) {
            dialog = this.user.main_dialog();
            if (!dialog) {
                return return_fail(`no active dialog`, this.journal.log());
            }
        }

        try {
            await BotAPI.instance().sendDocument(
                dialog.chat_id,
                fs.createReadStream(filename),
                undefined,
                { contentType: "application/json" }
            );
        } catch (error) {
            return return_exception(error, this.journal.log(), "failed to send file");
        }
        return Status.ok();
    }
}
