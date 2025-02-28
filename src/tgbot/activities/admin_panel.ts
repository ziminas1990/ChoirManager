import fs from "fs";

import { Status } from "../../status.js";
import { Runtime } from "../runtime.js";
import TelegramBot from "node-telegram-bot-api";
import { BotAPI } from "../api/telegram.js";

export class AdminPanel {
    constructor(private runtime: Runtime)
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

    send_file_to_admin(filename: string, content_type: string): Status {
        const admins = [...this.runtime.all_users()].filter(logic => logic.is_admin());
        const problems: Status[] = [];
        for (const admin of admins) {
            const dialog = admin.main_dialog();
            if (!dialog) {
                continue;
            }
            try {
                BotAPI.instance().sendDocument(
                    dialog.chat_id,
                    fs.createReadStream(filename),
                    undefined,
                    {
                    contentType: content_type,
                    }
                );
            } catch (err) {
                problems.push(Status.fail(`failed to send file to admin ${dialog.chat_id}: ${err}`));
            }
        }
        return Status.ok_and_warnings("send file to admins", problems);
    }

    private set_announce_thread(msg: TelegramBot.Message): Status {
        if (msg.message_thread_id == undefined) {
            return Status.fail("message thread id is undefined");
        }
        this.runtime.set_announce_thread(msg.chat.id, msg.message_thread_id);
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
        this.runtime.set_manager_chat_id(msg.chat.id);
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

        const admins = [...this.runtime.all_users()].filter(logic => logic.is_admin());
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
