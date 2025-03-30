import fs from "fs";
import TelegramBot from "node-telegram-bot-api";

import { Status, StatusWith } from "@src/status.js";
import { Journal } from "@src/tgbot/journal.js";
import { Formatting, return_fail } from "@src/tgbot/utils.js";
import { Logic } from "@src/tgbot/logic/abstracts.js";
import { TelegramUser } from "./telegram_user.js";
import { CoreAPI } from "@src/tgbot/use_cases/core.js";
import { Role, User } from "@src/tgbot/database.js";
import { Translator } from "@src/tgbot/use_cases/translator.js";
import { AdminActions } from "@src/tgbot/use_cases/admin_actions.js";

export type Config = {
    token_file: string;
    formatting: Formatting;
}

export type IcomingItem = {
    what: "message",
    message: TelegramBot.Message;
} | {
    what: "callback",
    callback: TelegramBot.CallbackQuery;
}

type PendingAction = () => Promise<Status>;

export class TgAdapter extends Logic<void> {
    private bot?: TelegramBot;
    private users: Map<string, TelegramUser> = new Map();
    private pending_actions: PendingAction[] = [];

    private journal: Journal;

    private choir_chat_id?: number;
    private announce_thread_id?: number;
    private managers_chat_id?: number;

    public static unpack(
        cfg: Config,
        packed: ReturnType<typeof TgAdapter.pack>,
        parent_journal: Journal)
    : TgAdapter
    {
        const adapter = new TgAdapter(cfg, parent_journal)
        adapter.unpack(packed);
        return adapter;
    }

    public static pack(adapter: TgAdapter) {
        return {
            choir_chat_id: adapter.choir_chat_id,
            announce_thread_id: adapter.announce_thread_id,
            managers_chat_id: adapter.managers_chat_id,
            users: [...adapter.users.values()].map(user => TelegramUser.pack(user)),
        } as const;
    }

    private unpack(packed: ReturnType<typeof TgAdapter.pack>) {
        this.choir_chat_id = packed.choir_chat_id;
        this.announce_thread_id = packed.announce_thread_id;
        this.managers_chat_id = packed.managers_chat_id;

        for (const packed_user of packed.users) {
            const tgid = packed_user.tgid;
            const user_info = CoreAPI.get_user_by_tg_id(tgid, false);
            if (!user_info.ok() || user_info.value == undefined) {
                this.journal.log().warn(`Can't get user ${tgid}: ${user_info.what()}`);
                continue;
            }
            const user = TelegramUser.unpack(user_info.value, packed_user, this.journal);
            this.users.set(tgid, user);
        }
    }

    constructor(private cfg: Config, parent_journal: Journal) {
        super(50);
        this.journal = parent_journal.child("adapter.telegram");
    }

    async init(): Promise<Status> {
        try {
            const token = fs.readFileSync(this.cfg.token_file, 'utf-8');
            if (!token) {
                return Status.fail("Telegram token not found");
            }
            this.bot = new TelegramBot(token, { polling: true });
            this.bot.on("message", (msg) => {
                const status = msg.chat.type == "private" ?
                    this.handle_private_message(msg) :
                    this.handle_group_message(msg);
                if (!status.ok()) {
                    this.journal.log().warn(`failed to handle message: ${status.what()}`);
                }
            });
            this.bot.on("callback_query", (query) => {
                const status = this.handle_callback(query);
                if (!status.ok()) {
                    this.journal.log().error(`failed to handle callback: ${status.what()}`);
                }
            });
            for (const [userid, user] of this.users.entries()) {
                const status = user.init(this.bot);
                if (!status.ok()) {
                    this.journal.log().error(`failed to init user: ${status.what()}`);
                    this.users.delete(userid);
                }
            }
            return Status.ok();
        } catch (e) {
            return Status.exception(e);
        }
    }

    protected async proceed_impl(_: Date): Promise<StatusWith<void[]>>
    {
        return Status.ok().with([]);
    }

    // NOTE: this function must NOT be async, it should return immediately
    private handle_private_message(msg: TelegramBot.Message): Status {
        this.log_message(msg);

        const tgid = msg.from?.username;
        if (tgid == undefined) {
            return Status.fail("username is undefined");
        }

        const status = this.get_or_create_user(tgid, msg.chat.id);
        if (!status.ok()) {
            return status.wrap(`can't get/create user ${tgid}`);
        }
        const user = status.value!;
        user.put_incoming_item({ what: "message", message: msg });
        return Status.ok();
    }

    // NOTE: this function must NOT be async, it should return immediately
    private handle_group_message(msg: TelegramBot.Message): Status {
        const tgid = msg.from?.username;
        if (tgid == undefined) {
            return return_fail("username is undefined", this.journal.log());
        }

        const user_id = msg.from?.username;
        if (user_id == undefined) {
            return Status.ok();  // just ignore
        }

        let user_info: User | undefined = undefined;
        {
            const status = CoreAPI.get_user_by_tg_id(user_id, true);
            if (!status.ok() || status.value == undefined) {
                return Status.fail(`user ${user_id} not found`);
            }
            user_info = status.value!;
        }

        const sent_by_admin   = user_info.roles.includes(Role.Admin);
        const sent_to_bot     = msg.text?.includes("@ursa_major_choir");
        const is_announce     = msg.chat.id == this.choir_chat_id &&
                                msg.message_thread_id == this.announce_thread_id;
        const sent_by_manager = user_info.roles.includes(Role.Manager);

        if (sent_to_bot || is_announce) {
            this.log_message(msg);
        }

        if (sent_by_admin && sent_to_bot) {
            this.pending_actions.push(async () => await this.handle_admin_message(msg));
        }

        if (is_announce && sent_by_manager && msg.text != undefined) {
            this.pending_actions.push(async () =>
                await Translator.translate_announce(user_info, msg.text!, this.journal));
        }
        return Status.ok();
    }

    // NOTE: this function must NOT be async, it should return immediately
    private handle_callback(query: TelegramBot.CallbackQuery): Status {
        const username = query.from?.username
        this.journal.log().info(`Callback query from ${username} in ${query.message?.chat.id}: ${query.data}`);
        if (username == undefined) {
            return Status.fail("username is undefined");
        }

        let status = this.get_user(username);
        if (!status.ok()) {
            return status;
        }
        const user = status.value!;
        user.put_incoming_item({ what: "callback", callback: query });
        return Status.ok();
    }

    async handle_admin_message(msg: TelegramBot.Message): Promise<Status> {
        this.journal.log().info(`Admin panel message: ${msg.text}`);
        if (msg.text?.includes("this is announces thread")) {
            if (msg.message_thread_id == undefined) {
                return return_fail("message thread id is undefined", this.journal.log());
            }
            return this.on_set_announce_thread_message(msg);
        }
        if (msg.text?.includes("this is managers chat")) {
            return this.on_set_manager_chat_message(msg);
        }
        return return_fail("unexpected message", this.journal.log());
    }

    private async on_set_announce_thread_message(msg: TelegramBot.Message): Promise<Status> {
        this.bot!.sendMessage(msg.chat.id, "Got it! This will be announces thread now.", {
            message_thread_id: msg.message_thread_id,
        });
        this.choir_chat_id = msg.chat.id;
        this.announce_thread_id = msg.message_thread_id;

        // Notify all admins
        const message = [
            `Announce thread set:`,
            `Group: ${msg.chat.title} (${this.choir_chat_id})`,
            `Thread: ${this.announce_thread_id}`,
        ].join("\n");
        await AdminActions.notify_all_admins(message, this.journal);
        return Status.ok();
    }

    private async on_set_manager_chat_message(msg: TelegramBot.Message): Promise<Status> {
        this.bot!.sendMessage(msg.chat.id, "Got it! This will be managers chat now.");
        this.managers_chat_id = msg.chat.id;
        const message = [
            `Manager chat set:`,
            `Group: ${msg.chat.title} (${this.managers_chat_id})`,
        ].join("\n")
        await AdminActions.notify_all_admins(message, this.journal);
        return Status.ok();
    }

    private log_message(msg: TelegramBot.Message) {
        if (msg.text) {
            if (!msg.text.includes("\n")) {
                this.journal.log().info(`Message from ${msg.from?.username} in ${msg.chat.id}: ${msg.text}`);
            } else {
                this.journal.log().info([
                    `Message from ${msg.from?.username} in ${msg.chat.id}:`,
                    msg.text,
                ].join("\n"));
            }
        } else {
            this.journal.log().info(`Empty message from ${msg.from?.username} in ${msg.chat.id}`);
        }
    }

    private get_user(tgid: string): StatusWith<TelegramUser> {
        const user = this.users.get(tgid);
        if (user) {
            return Status.ok().with(user);
        }
        return Status.fail("user not found");
    }

    private get_or_create_user(tgid: string, chat_id: number): StatusWith<TelegramUser> {
        const user = this.users.get(tgid);
        if (user) {
            return Status.ok().with(user);
        }
        const user_data = CoreAPI.get_user_by_tg_id(tgid, true);
        if (!user_data.ok() || user_data.value == undefined) {
            return Status.fail("user not found");
        }
        if (this.bot == undefined) {
            return Status.fail("bot is not initialized");
        }

        this.journal.log().info(`Creating telegram agent for ${tgid}...`);

        const new_user = new TelegramUser(user_data.value, chat_id, this.journal);
        let status = new_user.init(this.bot);
        if (!status.ok()) {
            return status.wrap("initialization error");
        }

        this.users.set(tgid, new_user);
        this.journal.log().info(`Telegram agent for ${tgid} created`);
        return Status.ok().with(new_user);
    }
}

