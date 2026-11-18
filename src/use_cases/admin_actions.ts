import { Expected, Status } from "@src/utils/expected.js";
import { IJournal } from "@src/interfaces/journal.js";
import { Runtime } from "@src/runtime.js";
import { user_tg_username } from "@src/entities/user.js";
import { exit } from "process";

export class AdminActions {

    static async notify_all_admins(notification: string, journal: IJournal) {
        journal.info({ notification }, "Notifying all admins");
        const users = Runtime.get_instance().all_users();
        for (const user of users) {
            const admin_agents = user.as_admin();
            for (const agent of admin_agents ?? []) {
                const status = await agent.send_notification(notification);
                if (!status.ok) {
                    journal.warning(`Failed to notify admin @${user_tg_username(user.data)}: ${status.error}`);
                }
            }
        }
    }

    static stop_application(journal: IJournal): Promise<Status> {
        journal.info("Stopping application...");
        setTimeout(() => exit(0), 1000);
        return Promise.resolve(Expected.ok(undefined));
    }
}
