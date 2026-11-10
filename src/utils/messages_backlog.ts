import { IMessagesBacklog, Message } from "@src/interfaces/messages_backlog.js";
import { Journal } from "@src/journal.js";

export async function save_message(
    backlog: IMessagesBacklog | undefined,
    message: Message,
    operation: "add" | "update",
    journal: Journal,
): Promise<void> {
    if (!backlog) {
        journal.log().error("Cannot save message: backlog is not configured");
        return;
    }
    try {
        const status = operation === "add"
            ? await backlog.add_message(message)
            : await backlog.update_message(message);
        if (!status.ok) {
            journal.log().error({ operation, message_id: message.message_id, error: status.error },
                "Failed to save message to backlog");
        }
    } catch (error) {
        journal.log().error({ operation, message_id: message.message_id, error },
            "Failed to save message to backlog");
    }
}
