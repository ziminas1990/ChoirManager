import { Expected, Status } from "@src/utils/expected.js";
import { Runtime } from "@src/runtime.js";
import { GroupChatMessage } from "@src/logic/group_chat";

export class AnnouncesChat {

    public static async on_new_message(message: GroupChatMessage)
    : Promise<Status>
    {
        const runtime = Runtime.get_instance();

        const announce_chat = runtime.get_announce_chat();
        if (!announce_chat) {
            return Expected.err("Announce chat is not configured");
        }

        announce_chat.on_new_message(message);
        return Expected.ok(undefined);
    }
}