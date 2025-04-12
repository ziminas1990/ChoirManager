import { Status } from "@src/status.js";
import { Journal } from "@src/journal.js";
import { Runtime } from "@src/runtime.js";
import { Config } from "@src/config.js";
import { return_fail } from "@src/utils.js";
import { User } from "@src/database.js";

export class AdminActions {

    static async notify_all_admins(notification: string, journal: Journal) {
        journal.log().info({ notification }, "Notifying all admins");
        const users = Runtime.get_instance().all_users();
        for (const user of users) {
            const admin_agents = user.as_admin();
            for (const agent of admin_agents ?? []) {
                const status = await agent.send_notification(notification);
                if (!status.ok()) {
                    journal.log().warn(`Failed to notify admin @${user.data.tgid}: ${status.what()}`);
                }
            }
        }
    }

    static async send_runtime_backup(user: User, journal: Journal): Promise<Status> {
        journal.log().info(`Sending runtime backup to @${user.tgid}`);

        const user_logic = Runtime.get_instance().get_user(user.tgid);
        if (!user_logic) {
            return return_fail(`User ${user.tgid} not found`, journal.log());
        }

        if (!user_logic.is_admin()) {
            return return_fail(`User ${user.tgid} is not an admin`, journal.log());
        }

        for (const agent of user_logic.as_admin()) {
            const status = await agent.send_runtime_backup(Config.data.runtime_cache_filename);
            if (!status.ok()) {
                journal.log().warn([
                    `Failed to send runtime backup to @${agent.base().userid()}`,
                    `Error: ${status.what()}`,
                ].join("\n"));
            }
        }
        return Status.ok();
    }

    static async send_logs(user: User, journal: Journal): Promise<Status> {
        journal.log().info(`Sending logs to @${user.tgid}`);

        const user_logic = Runtime.get_instance().get_user(user.tgid);
        if (!user_logic) {
            return return_fail(`User ${user.tgid} not found`, journal.log());
        }

        if (!user_logic.is_admin()) {
            return return_fail(`User ${user.tgid} is not an admin`, journal.log());
        }

        for (const agent of user_logic.as_admin()) {
            const status = await agent.send_logs(Config.data.logs_file);
            if (!status.ok()) {
                journal.log().warn([
                    `Failed to send runtime backup to @${agent.base().userid()}`,
                    `Error: ${status.what()}`,
                ].join("\n"));
            }
        }

        return Status.ok();
    }
}

