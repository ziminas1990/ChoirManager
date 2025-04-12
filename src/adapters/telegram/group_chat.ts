import TelegramBot from "node-telegram-bot-api";
import { IGroupChat } from "@src/interfaces/group_chat.js";
import { Status } from "@src/status.js";
import { return_exception, return_fail } from "@src/utils.js";
import { Journal } from "@src/journal.js";


export class GroupChat implements IGroupChat {
    private journal: Journal;

    constructor(
        private readonly chat_id: number,
        private readonly thread_id: number | undefined,
        private readonly bot: TelegramBot,
        parent_journal: Journal)
    {
        this.journal = parent_journal.child(`group.${chat_id}`);
    }

    async send_message(message: string): Promise<Status> {
        if (!this.bot) {
            return return_fail("API is not initialized", this.journal.log());
        }
        try {
            await this.bot.sendMessage(this.chat_id, message, {
                parse_mode: "HTML",
                message_thread_id: this.thread_id,
            });
            return Status.ok();
        } catch (e) {
            return return_exception(e, this.journal.log());
        }
    }

    // From IBaseAgent
    async send_file(filename: string, caption?: string, content_type?: string): Promise<Status> {
        if (!this.bot) {
            return return_fail("API is not initialized", this.journal.log());
        }
        try {
            const options: TelegramBot.SendDocumentOptions = {
                caption,
            };
            const file_options: TelegramBot.FileOptions = {
                contentType: content_type,
            };
            await this.bot.sendDocument(this.chat_id, filename, options, file_options);
            return Status.ok();
        } catch (e) {
            return return_exception(e, this.journal.log());
        }
    }

}