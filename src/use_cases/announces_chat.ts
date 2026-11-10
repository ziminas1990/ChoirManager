import { Expected, Status } from "@src/utils/expected.js";
import { Runtime } from "@src/runtime.js";
import { Message } from "@src/interfaces/messages_backlog.js";
import { Journal } from "@src/journal.js";
import { save_message } from "@src/utils/messages_backlog.js";

export class AnnouncesChat {

    public static async on_new_message(message: Message, journal: Journal)
    : Promise<Status>
    {
        const runtime = Runtime.get_instance();

        await save_message(runtime.get_announce_backlog(), message, "add", journal);
        return Expected.ok(undefined);
    }
}
