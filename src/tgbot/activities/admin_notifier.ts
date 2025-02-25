import { Status } from "../../status.js";
import { Runtime } from "../runtime.js";
import { UserLogic } from "../logic/user.js";
import { Language } from "../database.js";

export class AdminNotifier {
    private admins: UserLogic[] = [];

    constructor(private runtime: Runtime)
    {
        this.admins = [...this.runtime.all_users()].filter(logic => logic.is_admin());
    }

    start(): Status {
        // Notify all admins that bot is started
        for (const admin of this.admins) {
            for (const dialog of admin.all_dialogs()) {
                dialog.send_message(Messages.not_started(admin.data.lang));
            }
        }
        return Status.ok();
    }
}

class Messages {
    static not_started(lang: Language): string {
        switch (lang) {
            case "ru": return "Бот перезапущен";
            case "en": return "Bot has been restarted";
        }
    }
}
