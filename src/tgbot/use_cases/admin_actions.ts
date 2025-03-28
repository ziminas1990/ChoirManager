import { Status } from "@src/status.js";
import { Journal } from "@src/tgbot/journal.js";
import { Runtime } from "@src/tgbot/runtime.js";
import { Config } from "@src/tgbot/config.js";
import { return_fail } from "@src/tgbot/utils.js";
import { User } from "@src/tgbot/database.js";
import { UserLogic } from "@src/tgbot/logic/user.js";

export class AdminActions {

    static async notify_all_admins(notification: string, journal: Journal) {
        journal.log().info({ notification }, "Notifying all admins");
        const users = Runtime.get_instance().all_users();
        for (const user of users) {
            const admin_agents = user.as_admin();
            for (const agent of admin_agents ?? []) {
                const status = await agent.send_message(notification);
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

        const status = await this.send_file(user_logic, Config.data.runtime_cache_filename, journal);
        return status.wrap(`Failed to send runtime backup to @${user.tgid}`);
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

        const status = await this.send_file(user_logic, Config.data.logs_file, journal);
        return status.wrap(`Failed to send logs to @${user.tgid}`);
    }

    private static async send_file(user: UserLogic, file: string, journal: Journal): Promise<Status> {
        const admin_agents = user.as_admin();
        for (const agent of admin_agents ?? []) {
            const status = await agent.send_file(file);
            if (!status.ok()) {
                journal.log().warn(`Failed to send file to @${user.data.tgid}: ${status.what()}`);
            }
        }
        return Status.ok();
    }
}

