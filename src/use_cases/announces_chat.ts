import { Status } from "@src/status.js";
import { Runtime } from "@src/runtime.js";
import { GroupChatMessage } from "@src/logic/group_chat";
import { IUserAgent } from "@src/interfaces/user_agent";

export class AnnouncesChat {

    public static async on_new_message(sender: IUserAgent, message: GroupChatMessage)
    : Promise<Status>
    {
        const runtime = Runtime.get_instance();

        const announce_chat = runtime.get_announce_chat();
        if (!announce_chat) {
            return Status.fail("Announce chat is not configured");
        }

        announce_chat.on_new_message(sender, message);
        return Status.ok();
    }
}