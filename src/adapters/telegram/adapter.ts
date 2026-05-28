import fs from "fs";
import TelegramBot from "node-telegram-bot-api";

import { Expected, Status } from "@src/utils/expected.js";
import { Journal } from "@src/journal.js";
import { Formatting, return_fail } from "@src/utils.js";
import { Logic } from "@src/logic/abstracts.js";
import { CoreAPI } from "@src/use_cases/core.js";
import { Role, User } from "@src/database.js";
import { Translator } from "@src/use_cases/translator.js";
import { AdminActions } from "@src/use_cases/admin_actions.js";
import { IAdapter, IManagersChat } from "@src/interfaces/adapter.js";
import { IUserAgent } from "@src/interfaces/user_agent.js";
import { GroupChat } from "@src/adapters/telegram/group_chat.js";
import { IGroupChat } from "@src/interfaces/group_chat.js";
import { TelegramUser } from "@src/adapters/telegram/telegram_user.js";
import { ManagersGroup } from "@src/adapters/telegram/dialogs/managers_group.js";
import { ManagersChat } from "@src/use_cases/managers_chat";
import { GroupChatMessage } from "@src/logic/group_chat";
import { AnnouncesChat } from "@src/use_cases/announces_chat";
import { DepositTrackingConfig } from "@src/fetchers/deposits_fetcher.js";
import { RuntimeConfig } from "@src/runtime.js";

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

type TgAdapterDependencies = {
    deposit_tracking?: DepositTrackingConfig;
    runtime: RuntimeConfig;
}

export class TgAdapter extends Logic<void> implements IAdapter {
    private bot?: TelegramBot;
    private users: Map<string, TelegramUser> = new Map();
    private pending_actions: PendingAction[] = [];

    private journal: Journal;

    private choir_chat_id?: number;
    private announce_thread_id?: number;
    private managers_chat_id?: number;

    private managers_chat?: IManagersChat;

    public static unpack(
        cfg: Config,
        dependencies: TgAdapterDependencies,
        packed: ReturnType<typeof TgAdapter.pack>,
        parent_journal: Journal)
    : TgAdapter
    {
        const adapter = new TgAdapter(cfg, dependencies, parent_journal)
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
            if (!user_info.ok) {
                this.journal.log().warn(`Can't get user ${tgid}: ${user_info.error}`);
                continue;
            }
            const user = TelegramUser.unpack(user_info.value, packed_user, this.dependencies, this.journal);
            this.users.set(tgid, user);
        }
    }

    constructor(
        private cfg: Config,
        private readonly dependencies: TgAdapterDependencies,
        parent_journal: Journal,
    ) {
        super(50);
        this.journal = parent_journal.child("adapter.telegram");
    }

    async init(): Promise<Status> {
        try {
            const token = fs.readFileSync(this.cfg.token_file, 'utf-8');
            if (!token) {
                return Expected.err("Telegram token not found");
            }
            this.bot = new TelegramBot(token, { polling: true });
            this.bot.on("message", (msg) => {
                const status = msg.chat.type == "private" ?
                    this.handle_private_message(msg) :
                    this.handle_group_message(msg);
                if (!status.ok) {
                    this.journal.log().warn(`failed to handle message: ${status.error}`);
                }
            });
            this.bot.on("edited_message", (msg) => {
                if (msg.chat.type != "group") {
                    return;
                }
                const status = this.handle_edited_group_message(msg);
                if (!status.ok) {
                    this.journal.log().error(`failed to handle edited message: ${status.error}`);
                }
            });
            this.bot.on("callback_query", (query) => {
                const status = this.handle_callback(query);
                if (!status.ok) {
                    this.journal.log().error(`failed to handle callback: ${status.error}`);
                }
            });
            for (const [userid, user] of this.users.entries()) {
                const status = user.init(this.bot);
                if (!status.ok) {
                    this.journal.log().error(`failed to init user: ${status.error}`);
                    this.users.delete(userid);
                }
            }
            return Expected.ok(undefined);
        } catch (e) {
            return (((e) instanceof Error) ? Expected.err((e).message) : Expected.err(String(e)));
        }
    }

    async get_user_agent(user_id: string): Promise<Expected<IUserAgent>> {
        return this.get_user(user_id);
    }

    async get_announcement_chat(): Promise<IGroupChat | undefined> {
        if (this.choir_chat_id == undefined || this.announce_thread_id == undefined) {
            return undefined;
        }
        return new GroupChat(this.choir_chat_id, this.announce_thread_id, this.bot!, this.journal);
    }

    async get_choir_chat(): Promise<IGroupChat | undefined> {
        if (this.choir_chat_id == undefined) {
            return undefined;
        }
        return new GroupChat(this.choir_chat_id, undefined, this.bot!, this.journal);
    }

    async get_managers_chat(): Promise<IManagersChat | undefined> {
        if (this.managers_chat) {
            return this.managers_chat;
        }
        if (this.managers_chat_id == undefined) {
            return undefined;
        }
        this.managers_chat = new ManagersGroup(
            new GroupChat(this.managers_chat_id, undefined, this.bot!, this.journal),
            this.journal
        );
        return this.managers_chat;
    }

    protected async proceed_impl(_: Date): Promise<Expected<void[]>>
    {
        for (const action of this.pending_actions) {
            const status = await action();
            if (!status.ok) {
                this.journal.log().warn(`pending action failed: ${status.error}`);
            }
        }
        this.pending_actions = [];

        return Expected.ok([]);
    }

    // NOTE: this function must NOT be async, it should return immediately
    private handle_private_message(msg: TelegramBot.Message): Status {
        this.log_message(msg, "private");

        const tgid = msg.from?.username;
        if (tgid == undefined) {
            return Expected.err("username is undefined");
        }

        const status = this.get_or_create_user(tgid, msg.chat.id);
        if (!status.ok) {
            return status.wrap_error(`can't get/create user ${tgid}`);
        }
        const user = status.value!;
        user.put_incoming_item({ what: "message", message: msg });
        return Expected.ok(undefined);
    }

    // NOTE: this function must NOT be async, it should return immediately
    private handle_group_message(msg: TelegramBot.Message): Status {
        const tgid = msg.from?.username;
        if (tgid == undefined) {
            return return_fail("username is undefined", this.journal.log());
        }

        const user_id = msg.from?.username;
        if (user_id == undefined) {
            return Expected.ok(undefined);  // just ignore
        }

        let user_info: User | undefined = undefined;
        {
            const status = CoreAPI.get_user_by_tg_id(user_id, true);
            if (!status.ok) {
                return Expected.err(`user ${user_id} not found`);
            }
            user_info = status.value!;
        }

        const general_thread  = msg.message_thread_id == undefined;
        const sent_by_admin   = user_info.roles.includes(Role.Admin);
        const sent_to_bot     = msg.text?.includes("@ursa_major_choir");
        const is_announce     = !general_thread &&
                                msg.chat.id == this.choir_chat_id &&
                                msg.message_thread_id == this.announce_thread_id;
        const sent_by_manager = user_info.roles.includes(Role.Manager);
        const sent_to_managers_chat = general_thread && msg.chat.id === this.managers_chat_id;

        if (sent_to_bot || is_announce) {
            this.log_message(msg, "group");
        }

        if (sent_by_admin && sent_to_bot && !sent_to_managers_chat) {
            this.pending_actions.push(async () => {
                const status = await this.handle_admin_message(msg);
                if (!status.ok) {
                    return status.wrap_error("failed to handle admin message");
                }
                return status;
            });
        }

        if (is_announce && sent_by_manager && msg.text != undefined) {
            this.pending_actions.push(async () => {
                const status = await this.handle_announce_chat_message(msg);
                if (!status.ok) {
                    return status.wrap_error("failed to handle announce chat message");
                }
                return status;
            });
            this.pending_actions.push(async () => {
                const status = await Translator.translate_announce(user_info, msg.text!, this.journal);
                if (!status.ok) {
                    return status.wrap_error("failed to translate announce");
                }
                return status;
            });
        }

        if (sent_to_managers_chat) {
            this.pending_actions.push(async () => {
                const status = await this.handle_managers_chat_message(msg);
                if (!status.ok) {
                    return status.wrap_error("failed to handle managers chat message");
                }
                return status;
            });
        }

        return Expected.ok(undefined);
    }

    private handle_edited_group_message(msg: TelegramBot.Message): Status {
        this.log_message(msg, "group");
        return Expected.ok(undefined);
    }

    // NOTE: this function must NOT be async, it should return immediately
    private handle_callback(query: TelegramBot.CallbackQuery): Status {
        const username = query.from?.username
        this.journal.log().info(`Callback query from ${username} in ${query.message?.chat.id}: ${query.data}`);
        if (username == undefined) {
            return Expected.err("username is undefined");
        }

        let status = this.get_user(username);
        if (!status.ok) {
            return status.wrap_error(`user ${username} not found`);
        }
        const user = status.value!;
        user.put_incoming_item({ what: "callback", callback: query });
        return Expected.ok(undefined);
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

    async handle_managers_chat_message(msg: TelegramBot.Message): Promise<Status> {
        const username = msg.from?.username;
        if (msg.text == undefined || username == undefined) {
            // Ignoring message
            return Expected.ok(undefined);
        }

        const user = this.get_user(username);
        if (!user.ok) {
            return user.wrap_error(`can't get user ${username}`);
        }

        const message: GroupChatMessage = {
            time: new Date(msg.date * 1000),
            message_id: msg.message_id.toString(),
            user_id: username,
            text: msg.text,
        }

        if (msg.text.startsWith("@ursa_major_choir")) {
            this.bot!.sendMessage(msg.chat.id, "Пошёл думать, скоро вернусь...");
            const status = await ManagersChat.answer_question(msg.text);
            if (!status.ok) {
                this.bot!.sendMessage(msg.chat.id,
                    `Я потерпел фиаско:\n\n${status.error}`);
                this.journal.log().error(`Failed to answer question: ${status.error}`);
            } else {
                this.bot!.sendMessage(msg.chat.id, status.value!, {
                    parse_mode: "HTML",
                });
            }
            return Expected.ok(undefined);
        }

        const status = await ManagersChat.on_new_message(user.value, message);
        if (!status.ok) {
            return status;
        }

        return Expected.ok(undefined);
    }

    async handle_announce_chat_message(msg: TelegramBot.Message): Promise<Status> {
        const username = msg.from?.username;
        if (msg.text == undefined || username == undefined) {
            // Ignoring message
            return Expected.ok(undefined);
        }

        const user = this.get_user(username);
        if (!user.ok) {
            return user.wrap_error(`can't get user ${username}`);
        }

        const message: GroupChatMessage = {
            time: new Date(msg.date * 1000),
            message_id: msg.message_id.toString(),
            user_id: username,
            text: msg.text,
        }

        const status = await AnnouncesChat.on_new_message(user.value, message);
        if (!status.ok) {
            return status;
        }

        return Expected.ok(undefined);
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
        return Expected.ok(undefined);
    }

    private async on_set_manager_chat_message(msg: TelegramBot.Message): Promise<Status> {
        this.bot!.sendMessage(msg.chat.id, "Got it! This will be managers chat now.");
        this.managers_chat_id = msg.chat.id;
        const message = [
            `Manager chat set:`,
            `Group: ${msg.chat.title} (${this.managers_chat_id})`,
        ].join("\n")
        await AdminActions.notify_all_admins(message, this.journal);
        return Expected.ok(undefined);
    }

    private log_message(msg: TelegramBot.Message, msg_type: "private" | "group") {
        if (msg.text) {
            if (!msg.text.includes("\n")) {
                this.journal.log().info(`${msg_type} message from ${msg.from?.username} in ${msg.chat.id}: ${msg.text}`);
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

    private get_user(tgid: string): Expected<TelegramUser> {
        const user = this.users.get(tgid);
        if (user) {
            return Expected.ok(user);
        }
        return Expected.err("user not found");
    }

    private get_or_create_user(tgid: string, chat_id: number): Expected<TelegramUser> {
        const user = this.users.get(tgid);
        if (user) {
            return Expected.ok(user);
        }
        const user_data = CoreAPI.get_user_by_tg_id(tgid, true);
        if (!user_data.ok) {
            return Expected.err("user not found");
        }
        if (this.bot == undefined) {
            return Expected.err("bot is not initialized");
        }

        this.journal.log().info(`Creating telegram agent for ${tgid}...`);

        const new_user = new TelegramUser(user_data.value, chat_id, this.dependencies, this.journal);
        let status = new_user.init(this.bot);
        if (!status.ok) {
            return status.wrap_error("initialization error");
        }

        this.users.set(tgid, new_user);
        this.journal.log().info(`Telegram agent for ${tgid} created`);
        return Expected.ok(new_user);
    }
}

