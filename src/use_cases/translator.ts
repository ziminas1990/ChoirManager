import { Expected, Status } from "@src/utils/expected.js";
import { Runtime } from "@src/runtime.js";
import { Language, UserData, user_tg_username } from "@src/entities/user.js";
import { GoogleTranslate } from "@src/api/google_translate.js";
import { Journal } from "@src/journal.js";

export class Translator {

    static async translate_announce(
        author: UserData,
        announce: string,
        journal: Journal
    ): Promise<Status> {
        if (!announce) {
            return Expected.ok(undefined);
        }

        const users = [...Runtime.get_instance().all_users()].filter(logic => logic.data.lang !== Language.RU);
        if (users.length == 0) {
            return Expected.ok(undefined);
        }

        const author_tgid = user_tg_username(author);
        const translated_text = await GoogleTranslate.translate([
            `Объявление от ${author.name} ${author.surname ?? ""} (@${author_tgid}):`,
            "",
            announce,
            "",
        ].join("\n"), "en");

        for (const user of users) {
            if (user_tg_username(user.data) == author_tgid) {
                continue;
            }
            const agents = user.all_agents();
            for (const agent of agents) {
                const status = await agent.send_message(translated_text);
                if (!status.ok) {
                    journal.log().warn(`failed to send announce to ${user_tg_username(user.data)}: ${status.error}`);
                }
            }
        }
        return Expected.ok(undefined);
    }

}
