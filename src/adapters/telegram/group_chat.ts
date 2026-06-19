import TelegramBot from "node-telegram-bot-api";
import { IGroupChat } from "@src/interfaces/group_chat.js";
import { Expected, Status } from "@src/utils/expected.js";
import { return_exception, return_fail } from "@src/utils.js";
import { Journal } from "@src/journal.js";


export class GroupChat implements IGroupChat {
    private journal: Journal;

    // Can't send messages more often than 1 message per 1 second
    private last_api_call?: Date;

    constructor(
        private readonly chat_id: number,
        private readonly thread_id: number | undefined,
        private readonly bot: TelegramBot,
        parent_journal: Journal)
    {
        this.journal = parent_journal.child(`group.${chat_id}`);
    }

    async send_message(message: string): Promise<Expected<string>> {
        if (!this.bot) {
            return return_fail("API is not initialized", this.journal.log());
        }
        try {
            await this.wait_api_cooldown();
            const sent = await this.bot.sendMessage(this.chat_id, message, {
                parse_mode: "HTML",
                message_thread_id: this.thread_id,
            });
            return Expected.ok(sent.message_id.toString());
        } catch (e) {
            return return_exception(e, this.journal.log());
        }
    }

    async send_typing_action(): Promise<Status> {
        if (!this.bot) {
            return return_fail("API is not initialized", this.journal.log());
        }
        try {
            await this.bot.sendChatAction(this.chat_id, "typing", {
                message_thread_id: this.thread_id,
            });
            return Expected.ok(undefined);
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
            await this.wait_api_cooldown();
            await this.bot.sendDocument(this.chat_id, filename, options, file_options);
            return Expected.ok(undefined);
        } catch (e) {
            return return_exception(e, this.journal.log());
        }
    }

    private async wait_api_cooldown(): Promise<void> {
        if (this.last_api_call != undefined) {
            const elapsed_ms = new Date().getTime() - this.last_api_call.getTime();
            if (elapsed_ms < 1000) {
                await new Promise(resolve => setTimeout(resolve, 1000 - elapsed_ms));
            }
        }
        this.last_api_call = new Date();
    }

}