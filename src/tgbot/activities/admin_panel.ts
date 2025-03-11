import TelegramBot from "node-telegram-bot-api";
import pino from "pino";
import { Status } from "../../status.js";
import { Runtime } from "../runtime.js";
import { BotAPI } from "../api/telegram.js";
import { return_exception, return_fail } from "../utils.js";

export class AdminPanel {
    constructor(private readonly logger: pino.Logger)
    {}

    async start(): Promise<Status> {
        // Notify all admins that bot is started
        this.send_all_admins(Messages.bot_started());
        return Status.ok();
    }

    async handle_message(msg: TelegramBot.Message): Promise<Status> {
        this.logger.info(`Admin panel message: ${msg.text}`);
        if (msg.text?.includes("this is announces thread")) {
            return (await this.set_announce_thread(msg))
                .wrap("failed to set announces thread");
        }
        if (msg.text?.includes("this is managers chat")) {
            return (await this.set_manager_chat_id(msg))
                .wrap("failed to set managers chat");
        }
        return return_fail("unexpected message", this.logger);
    }

    async send_runtime_backup_to_admins(): Promise<Status> {
        this.logger.info("Sending runtime backup to admins");
        const runtime = Runtime.get_instance();
        const admins = [...runtime.all_users()].filter(logic => logic.is_admin());
        const problems: Status[] = [];
        for (const admin of admins) {
            const status = await admin.send_runtime_backup();
            if (!status.ok()) {
                this.logger.warn(status.what());
                problems.push(status);
            }
        }
        return Status.ok_and_warnings("send runtime backup to admins", problems);
    }

    async send_notification(notification: string): Promise<Status> {
        const runtime = Runtime.get_instance();
        const admins = [...runtime.all_users()].filter(logic => logic.is_admin());
        const problems: Status[] = [];
        for (const admin of admins) {
            const dialog = admin.main_dialog();
            if (dialog) {
                const status = await dialog.send_message(notification);
                if (!status.ok()) {
                    this.logger.warn(status.what());
                    problems.push(status);
                }
            }
        }
        return Status.ok_and_warnings("send notification to admins", problems);
    }

    private async set_announce_thread(msg: TelegramBot.Message): Promise<Status> {
        if (msg.message_thread_id == undefined) {
            return return_fail("message thread id is undefined", this.logger);
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
        await this.send_all_admins([
            `Announce thread set:`,
            `Group: ${msg.chat.title} (${msg.chat.id})`,
            `Thread: ${msg.message_thread_id}`,
        ].join("\n"));
        return Status.ok();
    }

    private async set_manager_chat_id(msg: TelegramBot.Message): Promise<Status> {
        const runtime = Runtime.get_instance();
        runtime.set_manager_chat_id(msg.chat.id);
        BotAPI.instance().sendMessage(
            msg.chat.id,
            "Got it! This will be managers chat now.",
        );
        const status = await this.send_all_admins([
            `Manager chat set:`,
            `Group: ${msg.chat.title} (${msg.chat.id})`,
        ].join("\n"));
        return status.wrap("failed to send notification to admins");
    }

    private async send_all_admins(message: string): Promise<Status> {
        // TODO: add admins cache
        try {
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
        } catch (error) {
            return return_exception(error, this.logger);
        }
    }
}

class Messages {
    static bot_started(): string {
        return "Bot has been restarted";
    }
}
