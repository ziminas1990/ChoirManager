import { Expected, Status } from "@src/utils/expected.js";
import { Journal } from "@src/journal.js";
import { Runtime } from "@src/runtime.js";
import { RuntimeConfig } from "@src/runtime.js";
import { return_fail } from "@src/utils.js";
import { Role, UserData, user_has_role, user_tg_username } from "@src/entities/user.js";
import { exit } from "process";

export class AdminActions {

    static async notify_all_admins(notification: string, journal: Journal) {
        journal.log().info({ notification }, "Notifying all admins");
        const users = Runtime.get_instance().all_users();
        for (const user of users) {
            const admin_agents = user.as_admin();
            for (const agent of admin_agents ?? []) {
                const status = await agent.send_notification(notification);
                if (!status.ok) {
                    journal.log().warn(`Failed to notify admin @${user_tg_username(user.data)}: ${status.error}`);
                }
            }
        }
    }

    static async send_runtime_backup(user: UserData, config: RuntimeConfig, journal: Journal): Promise<Status> {
        const tgid = user_tg_username(user);
        journal.log().info(`Sending runtime backup to @${tgid}`);

        if (!user_has_role(user, Role.Admin)) {
            return return_fail(`User ${tgid} is not an admin`, journal.log());
        }

        const user_logic = Runtime.get_instance().get_user_logic(user.id.system_id);
        if (!user_logic) {
            return return_fail(`User ${tgid} has no runtime session`, journal.log());
        }

        for (const agent of user_logic.as_admin()) {
            const status = await agent.send_runtime_backup(config.runtime_cache_filename);
            if (!status.ok) {
                journal.log().warn([
                    `Failed to send runtime backup to @${user_tg_username(user)}`,
                    `Error: ${status.error}`,
                ].join("\n"));
            }
        }
        return Expected.ok(undefined);
    }

    static async send_logs(user: UserData, config: RuntimeConfig, journal: Journal): Promise<Status> {
        const tgid = user_tg_username(user);
        journal.log().info(`Sending logs to @${tgid}`);

        if (!user_has_role(user, Role.Admin)) {
            return return_fail(`User ${tgid} is not an admin`, journal.log());
        }

        const user_logic = Runtime.get_instance().get_user_logic(user.id.system_id);
        if (!user_logic) {
            return return_fail(`User ${tgid} has no runtime session`, journal.log());
        }

        for (const agent of user_logic.as_admin()) {
            const status = await agent.send_logs(config.logs_file);
            if (!status.ok) {
                journal.log().warn([
                    `Failed to send runtime backup to @${user_tg_username(user)}`,
                    `Error: ${status.error}`,
                ].join("\n"));
            }
        }

        return Expected.ok(undefined);
    }

    static stop_application(journal: Journal): Promise<Status> {
        journal.log().info("Stopping application...");
        setTimeout(() => exit(0), 1000);
        return Promise.resolve(Expected.ok(undefined));
    }
}
