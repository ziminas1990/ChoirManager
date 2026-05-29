import { IManagersChat, TableRecord } from "@src/interfaces/adapter.js";
import { Feedback } from "@src/entities/feedback.js";
import { Status } from "@src/utils/expected.js";
import { IGroupChat } from "@src/interfaces/group_chat.js";
import { Journal } from "@src/journal.js";
import { GlobalFormatter } from "@src/utils.js";

function escape_html(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

export class ManagersGroup implements IManagersChat {

    private journal: Journal;

    constructor(private chat: IGroupChat, parent_journal: Journal) {
        this.journal = parent_journal.child("managers_chat");
    }

    async on_new_feedback(feedback: Feedback): Promise<Status> {
        const formatter = GlobalFormatter.instance();
        this.journal.log().info(`new feedback: ${JSON.stringify(feedback)}`);

        const message: string[] = [
            formatter.bold("New feedback received"),
            "",
            formatter.quote(feedback.details),
        ];

        if (feedback.who) {
            message.push([
                formatter.bold("Author:"),
                `${feedback.who.name_surname} (@${feedback.who.tgid})`
            ].join(" "));
        }
        if (feedback.voice) {
            message.push(`${formatter.bold("Voice:")} ${feedback.voice}`);
        }
        if (!feedback.who && !feedback.voice) {
            message.push(formatter.italic("(sent anonymously)"));
        }
        message.push("");
        message.push("#feedback");

        return await this.chat.send_message(message.join("\n"));
    }

    async on_new_table_record(record: TableRecord): Promise<Status> {
        this.journal.log().info(`new table record: ${JSON.stringify(record)}`);

        const message: string[] = [
            `Новая запись в таблице "${escape_html(record.table_name)}":`,
            "",
            ...record.fields.map(field => [
                `<b>${escape_html(field.name)}</b>`,
                field.value.trim().length > 0 ? escape_html(field.value) : "(нет ответа)",
                "",
            ].join("\n")),
        ];

        return await this.chat.send_message(message.join("\n"));
    }
}