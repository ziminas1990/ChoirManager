import TelegramBot from "node-telegram-bot-api";
import { Status } from "../../status.js";
import { Runtime } from "../runtime.js";
import { BotAPI } from "../api/telegram.js";

export class AdminPanel {
    constructor()
    {}

    async start(): Promise<Status> {
        // Notify all admins that bot is started
        this.send_all_admins(Messages.bot_started());
        return Status.ok();
    }

    handle_message(msg: TelegramBot.Message): Status {
        if (msg.text?.includes("this is announces thread")) {
            return this.set_announce_thread(msg);
        }
        if (msg.text?.includes("this is managers chat")) {
            return this.set_manager_chat_id(msg);
        }
        return Status.fail("unexpected message");
    }

    async send_runtime_backup_to_admins(): Promise<Status> {
        const runtime = Runtime.get_instance();
        const admins = [...runtime.all_users()].filter(logic => logic.is_admin());
        const problems: Status[] = [];
        for (const admin of admins) {
            const status = await admin.send_runtime_backup();
            if (!status.ok()) {
                problems.push(status);
            }
        }
        return Status.ok_and_warnings("send runtime backup to admins", problems);
    }

    send_notification(notification: string): Status {
        const runtime = Runtime.get_instance();
        const admins = [...runtime.all_users()].filter(logic => logic.is_admin());
        const problems: Status[] = [];
        for (const admin of admins) {
            const dialog = admin.main_dialog();
            if (dialog) {
                dialog.send_message(notification);
            }
        }
        return Status.ok_and_warnings("send notification to admins", problems);
    }

    private set_announce_thread(msg: TelegramBot.Message): Status {
        if (msg.message_thread_id == undefined) {
            return Status.fail("message thread id is undefined");
        }
        const runtime = Runtime.get_instance();
        runtime.set_announce_thread(msg.chat.id, msg.message_thread_id);
        BotAPI.instance().sendMessage(
            msg.chat.id,
            "Got it! This will be announces thread now.",
            {
                message_thread_id: msg.message_thread_id,
            }
        );
        this.send_all_admins([
            `Announce thread set:`,
            `Group: ${msg.chat.title} (${msg.chat.id})`,
            `Thread: ${msg.message_thread_id}`,
        ].join("\n"));
        return Status.ok();
    }

    private set_manager_chat_id(msg: TelegramBot.Message): Status {
        const runtime = Runtime.get_instance();
        runtime.set_manager_chat_id(msg.chat.id);
        BotAPI.instance().sendMessage(
            msg.chat.id,
            "Got it! This will be managers chat now.",
        );
        this.send_all_admins([
            `Manager chat set:`,
            `Group: ${msg.chat.title} (${msg.chat.id})`,
        ].join("\n"));
        return Status.ok();
    }

    private async send_all_admins(message: string): Promise<Status> {
        // TODO: add admins cache

        const runtime = Runtime.get_instance();
        const admins = [...runtime.all_users()].filter(logic => logic.is_admin());
        const promises: Promise<any>[] = [];
        for (const admin of admins) {
            const dialog = admin.main_dialog();
            if (!dialog) {
                continue;
            }
            promises.push(dialog.send_message(message));
        }
        await Promise.all(promises);
        return Status.ok();
    }
}

class Messages {
    static bot_started(): string {
        return "Bot has been restarted";
    }
}
