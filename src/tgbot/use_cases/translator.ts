import { Status } from "../../status.js";
import { Runtime } from "../runtime.js";
import { Language, User } from "../database.js";
import { GoogleTranslate } from "../api/google_translate.js";
import { Journal } from "../journal.js";


export class Translator {

    static async translate_announce(
        runtime: Runtime,
        announce: string,
        author: User,
        journal: Journal
    ): Promise<Status> {
        if (!announce) {
            return Status.ok();
        }

        const users = [...runtime.all_users()].filter(logic => logic.data.lang !== Language.RU);
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
            const dialog = user.main_dialog();
            if (!dialog) {
                continue;
            }
            const status = await dialog.send_message(translated_text);
            if (!status.ok()) {
                journal.log().warn(`failed to send announce to ${user.data.tgid}: ${status.what()}`);
            }
        }
        return Status.ok();
    }

}