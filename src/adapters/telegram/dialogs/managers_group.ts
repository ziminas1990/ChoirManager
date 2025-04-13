import { IManagersChat } from "@src/interfaces/adapter.js";
import { Feedback } from "@src/entities/feedback.js";
import { Status } from "@src/status.js";
import { IGroupChat } from "@src/interfaces/group_chat.js";
import { Journal } from "@src/journal.js";
import { GlobalFormatter } from "@src/utils.js";

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
}