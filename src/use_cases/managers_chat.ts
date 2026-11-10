import { Expected, Status } from "@src/utils/expected.js";
import { Runtime } from "@src/runtime.js";
import { Message } from "@src/interfaces/messages_backlog.js";
import { Journal } from "@src/journal.js";
import { save_message } from "@src/utils/messages_backlog.js";

export class ManagersChat {

    public static async on_message_edited(message: Message, journal: Journal): Promise<Status> {
        const backlog = Runtime.get_instance().get_managers_backlog();
        await save_message(backlog, message, "update", journal);
        return Expected.ok(undefined);
    }

    public static async on_new_message(message: Message, journal: Journal): Promise<Status> {
        const runtime = Runtime.get_instance();

        await save_message(runtime.get_managers_backlog(), message, "add", journal);

        const managers_agent = runtime.get_managers_agent();
        if (managers_agent) {
            managers_agent.on_new_message(message);
        }
        return Expected.ok(undefined);
    }
}
