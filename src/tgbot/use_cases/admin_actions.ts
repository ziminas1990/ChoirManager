import { Status } from "../../status.js";
import { Journal } from "../journal.js";
import { Runtime } from "../runtime.js";
import { Config } from "../config.js";
import { BotAPI } from "../api/telegram.js";

export class AdminActions {

    static async notify_all_admins(
        runtime: Runtime,
        message: string,
        journal: Journal
    ): Promise<Status> {
        for (const user of runtime.all_users()) {
            const dialog = user.as_admin();
            if (dialog) {
                const status = await dialog.send_notification(message);
                if (!status.ok()) {
                    journal.log().warn(status.what());
                }
            }
        }
        return Status.ok();
    }

    static async send_runtime_backup(
        runtime: Runtime,
        journal: Journal,
    ): Promise<Status> {
        journal.log().info("Sending runtime backup to admins");
        for (const user of runtime.all_users()) {
            const dialog = user.as_admin();
            if (!dialog) {
                continue;
            }
            const status = await dialog.send_file(Config.data.runtime_cache_filename);
            if (!status.ok()) {
                journal.log().warn(status.what());
            }
        }
        return Status.ok();
    }

    static async set_announce_thread(
        runtime: Runtime,
        chat_title: string,
        chat_id: number,
        thread_id: number,
        journal: Journal): Promise<Status>
    {
        runtime.set_announce_thread(chat_id, thread_id);
        BotAPI.instance().sendMessage(
            chat_id,
            "Got it! This will be announces thread now.",
            {
                message_thread_id: thread_id,
            }
        );
        const status = await AdminActions.notify_all_admins(
            Runtime.get_instance(),
            [
                `Announce thread set:`,
                `Group: ${chat_title} (${chat_id})`,
                `Thread: ${thread_id}`,
            ].join("\n"),
            journal
        );
        if (!status.ok()) {
            journal.log().warn(`Failed to notify admins: ${status.what()}`);
        }
        return Status.ok();
    }

    static async set_manager_chat_id(
        runtime: Runtime,
        chat_title: string,
        chat_id: number,
        journal: Journal
    ): Promise<Status> {
        runtime.set_manager_chat_id(chat_id);
        BotAPI.instance().sendMessage(
            chat_id,
            "Got it! This will be managers chat now.",
        );
        const status = await AdminActions.notify_all_admins(
            Runtime.get_instance(),
            [
                `Manager chat set:`,
                `Group: ${chat_title} (${chat_id})`,
            ].join("\n"),
            journal
        );
        return status.wrap("failed to send notification to admins");
    }
}

