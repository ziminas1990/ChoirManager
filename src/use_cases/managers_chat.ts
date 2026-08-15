import { Expected, Status } from "@src/utils/expected.js";
import { Runtime } from "@src/runtime.js";
import { GroupChatMessage } from "@src/logic/group_chat.js";

export class ManagersChat {

    public static async on_new_message(message: GroupChatMessage): Promise<Status> {
        const runtime = Runtime.get_instance();

        const managers_chat = runtime.get_managers_chat();
        if (!managers_chat) {
            return Expected.err("Managers chat is not configured");
        }
        managers_chat.on_new_message(message);

        const managers_agent = runtime.get_managers_agent();
        if (managers_agent) {
            managers_agent.on_new_message(message);
        }
        return Expected.ok(undefined);
    }
}