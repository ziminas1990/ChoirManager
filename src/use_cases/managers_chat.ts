import { Status } from "@src/status.js";
import { Runtime } from "@src/runtime.js";
import { Message } from "@src/interfaces/messages_backlog";

export class ManagersChat {

    public static async on_new_message(message: Message): Promise<Status> {
        const runtime = Runtime.get_instance();

        const managers_chat = runtime.get_managers_chat_backlog();
        if (!managers_chat) {
            return Status.fail("Managers chat backlog is not configured");
        }

        const status = await managers_chat.add_message(message);
        if (!status.ok()) {
            return status.wrap("Failed to add message to managers chat backlog");
        }

        console.log(`Message added to managers chat backlog: ${JSON.stringify(message)}`);

        return Status.ok();
    }
}