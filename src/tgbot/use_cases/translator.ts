import { Status } from "@src/status.js";
import { Runtime } from "@src/tgbot/runtime.js";
import { Language, User } from "@src/tgbot/database.js";
import { GoogleTranslate } from "@src/tgbot/api/google_translate.js";
import { Journal } from "@src/tgbot/journal.js";

export class Translator {

    static async translate_announce(
        author: User,
        announce: string,
        journal: Journal
    ): Promise<Status> {
        if (!announce) {
            return Status.ok();
        }

        const users = [...Runtime.get_instance().all_users()].filter(logic => logic.data.lang !== Language.RU);
        if (users.length == 0) {
            return Status.ok();
        }

        const translated_text = await GoogleTranslate.translate([
            `Объявление от ${author.name} ${author.surname ?? ""} (@${author.tgid}):`,
            "",
            announce,
            "",
        ].join("\n"), "en");

        for (const user of users) {
            if (user.data.tgid == author.tgid) {
                continue;
            }
            const agents = user.base_agents();
            for (const agent of agents) {
                const status = await agent.send_message(translated_text);
                if (!status.ok()) {
                    journal.log().warn(`failed to send announce to ${user.data.tgid}: ${status.what()}`);
                }
            }
        }
        return Status.ok();
    }

}