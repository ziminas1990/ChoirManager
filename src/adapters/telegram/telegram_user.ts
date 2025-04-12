import TelegramBot from "node-telegram-bot-api";

import { IAccounterAgent, IAdminAgent, IChorister, IDepositOwnerAgent, IUserAgent } from "@src/interfaces/user_agent.js";
import { Status, StatusWith } from "@src/status.js";
import { Journal } from "@src/journal.js";
import { Role, User } from "@src/database.js";
import { return_exception, return_fail } from "@src/utils.js";
import { CoreAPI } from "@src/use_cases/core.js";
import { IcomingItem } from "./adapter.js";
import { TelegramCallbacks } from "./callbacks.js";
import { DepositOwnerDialog } from "./dialogs/deposit_owner_dialog.js";
import { AccounterDialog } from "./dialogs/accounter_dialog.js";
import { ChoristerDialog } from "./dialogs/chorister_dialog.js";
import { GuestDialog } from "./dialogs/guest_dialog.js";
import { AdminDialog } from "./dialogs/admin_dialog.js";


export class TelegramUser implements IUserAgent {
    private journal: Journal;
    private queue: IcomingItem[] = [];
    private bot?: TelegramBot;
    private callbacks_registry: TelegramCallbacks

    private deposit_owner_dialog?: DepositOwnerDialog;
    private accounter_dialog?: AccounterDialog;
    private chorister_dialog?: ChoristerDialog;
    private guest_dialog?: GuestDialog;
    private admin_dialog?: AdminDialog;

    private timings: {
        next_user_info_update?: number;
    };

    public static pack(user: TelegramUser) {
        return {
            tgid: user.user_info.tgid,
            chat_id: user.chat_id,
        } as const;
    }

    public static unpack(
        user_info: User,
        packed: ReturnType<typeof TelegramUser.pack>,
        parent_journal: Journal): TelegramUser
    {
        return new TelegramUser(user_info, packed.chat_id, parent_journal);
    }

    constructor(private user_info: User, private chat_id: number, parent_journal: Journal) {
        this.journal = parent_journal.child(`@${this.user_info.tgid}`);
        this.callbacks_registry = new TelegramCallbacks(this.journal);
        this.timings = {};
    }

    init(bot: TelegramBot): Status {
        this.bot = bot;

        const status = CoreAPI.on_new_user_agent(this.user_info.tgid, this);
        if (!status.ok()) {
            return status.wrap(`Can't register user ${this.user_info.tgid} agent`);
        }

        return Status.ok();
    }

    info() { return this.user_info; }

    put_incoming_item(item: IcomingItem) {
        this.queue.push(item);
    }

    agent_name(): string { return "TelegramUser"; }

    // From IUserAgent
    userid(): string { return this.user_info.tgid; }

    // From IUserAgent
    as_chorister(): IChorister {
        if (!this.chorister_dialog) {
            this.chorister_dialog = new ChoristerDialog(this, this.journal);
        }
        return this.chorister_dialog;
    }

    // From IUserAgent
    as_deposit_owner(): IDepositOwnerAgent {
        if (!this.deposit_owner_dialog) {
            this.deposit_owner_dialog = new DepositOwnerDialog(this, this.journal);
        }
        return this.deposit_owner_dialog;
    }

    // From IUserAgent
    as_accounter(): IAccounterAgent {
        if (!this.accounter_dialog) {
            this.accounter_dialog = new AccounterDialog(this);
        }
        return this.accounter_dialog;
    }

    // From IUserAgent
    as_admin(): IAdminAgent {
        if (!this.admin_dialog) {
            this.admin_dialog = new AdminDialog(this);
        }
        return this.admin_dialog;
    }

    create_keyboard_button(
        text: string,
        debug_name: string,
        callback: () => Promise<Status>,
        lifetime_sec?: number)
    : TelegramBot.InlineKeyboardButton {
        const callback_id = this.callbacks_registry.add_callback({
            fn: async () => { return await callback(); },
            journal: this.journal.child(`callback.${debug_name}`),
            debug_name: debug_name,
        }, lifetime_sec);
        return {
            text: text,
            callback_data: callback_id
        };
    }

    remove_keyboard_button(button: TelegramBot.InlineKeyboardButton): Status {
        const callback_id = button.callback_data;
        const text = button.text;
        if (!callback_id) {
            return return_fail("callback_data is not specified", this.journal.log());
        }
        if (this.callbacks_registry.remove_callback(callback_id)) {
            this.journal.log().debug({ callback_id, text }, "callback removed");
            return Status.ok();
        }
        return return_fail(`failed to remove callback ${callback_id}`, this.journal.log());
    }

    // From IUserAgent
    async send_message(message: string, options?: TelegramBot.SendMessageOptions)
    : Promise<StatusWith<number>> {
        if (!this.bot) {
            return return_fail("API is not initialized", this.journal.log());
        }
        try {
            const sent = await this.bot.sendMessage(this.chat_id, message, {
                ...options,
                parse_mode: "HTML"
            });
            this.journal.log().info({ message }, "message sent")
            return Status.ok().with(sent.message_id);
        } catch (e) {
            return return_exception(e, this.journal.log());
        }
    }

    // From IUserAgent
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
            this.journal.log().info({ document: filename }, "document sent")
            return Status.ok();
        } catch (e) {
            return return_exception(e, this.journal.log());
        }
    }

    async edit_message(message_id: number, what: {
        text?: string,
        inline_keyboard?: TelegramBot.InlineKeyboardButton[][]
    }): Promise<Status> {
        if (!this.bot) {
            return return_fail("API is not initialized", this.journal.log());
        }

        try {
            if (what.text != undefined) {
                await this.bot.editMessageText(what.text, {
                    chat_id: this.chat_id,
                    message_id: message_id,
                    parse_mode: "HTML",
                    reply_markup: what.inline_keyboard ? {
                        inline_keyboard: what.inline_keyboard,
                    } : undefined
                });
            } else if (what.inline_keyboard != undefined) {
                await this.bot.editMessageReplyMarkup(
                    {
                        inline_keyboard: what.inline_keyboard,
                    },
                    {
                        chat_id: this.chat_id,
                        message_id: message_id
                    }
                );
            }
            return Status.ok();
        } catch (e) {
            return return_exception(e, this.journal.log());
        }
    }

    async delete_message(message_id: number): Promise<Status> {
        if (!this.bot) {
            return return_fail("API is not initialized", this.journal.log());
        }
        try {
            const ok = await this.bot.deleteMessage(this.chat_id, message_id);
            return ok ? Status.ok() : return_fail("Failed to delete message", this.journal.log());
        } catch(e) {
            return return_exception(e, this.journal.log());
        }
    }

    async proceed(now: Date): Promise<void> {
        this.maybe_update_user_info(now);
        this.callbacks_registry.proceed(now);

        if (this.queue.length == 0) {
            return;
        }
        const main_dialog = this.get_main_dialog();

        for (const item of this.queue) {
            if (item.what == "message") {
                if (main_dialog) {
                    const status = await main_dialog.on_message(item.message);
                    if (!status.ok()) {
                        this.journal.log().error(`Failed to handle message: ${status.what()}`);
                    }
                } else {
                    this.journal.log().warn("ignoring message: no main dialog");
                }
            } else if (item.what == "callback") {
                const status = await this.callbacks_registry.on_callback(item.callback);
                if (!status.ok()) {
                    this.journal.log().error(`Failed to handle callback: ${status.what()}`);
                }
            }
        }
        this.queue = [];
    }

    maybe_update_user_info(now: Date) {
        if (this.timings.next_user_info_update == undefined) {
            this.timings.next_user_info_update = now.getTime() + 10000;
            return;
        }
        if (this.timings.next_user_info_update > now.getTime()) {
            return;
        }

        const user_info = CoreAPI.get_user_by_tg_id(this.userid(), true);
        if (user_info.ok() && user_info.value != undefined) {
            this.user_info = user_info.value!;
        }
    }

    private get_main_dialog(): ChoristerDialog | GuestDialog | undefined {
        if (this.user_info.is(Role.Guest)) {
            if (!this.guest_dialog) {
                this.guest_dialog = new GuestDialog(this, this.journal);
            }
            return this.guest_dialog;
        } else if (this.user_info.is(Role.Chorister)) {
            if (!this.chorister_dialog) {
                this.chorister_dialog = new ChoristerDialog(this, this.journal);
            }
            return this.chorister_dialog;
        }
        return undefined;
    }
}
