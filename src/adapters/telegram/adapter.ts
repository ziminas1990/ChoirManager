import fs from "fs";
import TelegramBot from "node-telegram-bot-api";

import { Expected, Status } from "@src/utils/expected.js";
import { Journal } from "@src/journal.js";
import { Formatting, return_fail } from "@src/utils.js";
import { Logic } from "@src/logic/abstracts.js";
import { Role, UserData } from "@src/entities/user.js";
import { Translator } from "@src/use_cases/translator.js";
import { AdminActions } from "@src/use_cases/admin_actions.js";
import { IAdapter, IManagersChat } from "@src/interfaces/adapter.js";
import { IUserAgent } from "@src/interfaces/user_agent.js";
import { GroupChat } from "@src/adapters/telegram/group_chat.js";
import { IGroupChat } from "@src/interfaces/group_chat.js";
import { TelegramUser } from "@src/adapters/telegram/telegram_user.js";
import { ManagersGroup } from "@src/adapters/telegram/dialogs/managers_group.js";
import { ManagersChat } from "@src/use_cases/managers_chat.js";
import { GroupChatMessage } from "@src/logic/group_chat.js";
import { AnnouncesChat } from "@src/use_cases/announces_chat.js";
import { DepositPresentationConfig } from "@src/adapters/deposit_service/factory.js";
import { AssistantConfig } from "@src/config.js";
import { RuntimeConfig } from "@src/runtime.js";
import { Environment } from "@src/components/environment.js";
import { PlainCollectionConfig, PlainCollectionFactory } from "@src/adapters/plain_collection/factory.js";
import { IPlainCollection } from "@src/interfaces/plain_collection.js";
import { telegram_user_firestore_converter } from "@src/adapters/telegram/telegram_user_mapper.js";
import {
    TelegramUserRecord,
    telegram_user_record_id,
} from "@src/adapters/telegram/telegram_user_record.js";

export type Config = {
    token_file: string;
    formatting: Formatting;
    users_storage: PlainCollectionConfig;
}

export type IcomingItem = {
    what: "message",
    message: TelegramBot.Message;
} | {
    what: "callback",
    callback: TelegramBot.CallbackQuery;
}

type TgAdapterDependencies = {
    deposit_presentation?: DepositPresentationConfig;
    runtime: RuntimeConfig;
    assistant?: AssistantConfig;
}

type PackedTgAdapter = {
    choir_chat_id?: number;
    announce_thread_id?: number;
    managers_chat_id?: number;
}

export class TgAdapter extends Logic<void> implements IAdapter {
    private bot?: TelegramBot;
    private users: Map<number, TelegramUser> = new Map();
    private readonly users_collection: IPlainCollection<TelegramUserRecord>;

    // Queue of incoming messages, processed in proceed()
    private messages_queue: TelegramBot.Message[] = [];

    private journal: Journal;

    private choir_chat_id?: number;
    private announce_thread_id?: number;
    private managers_chat_id?: number;

    private managers_chat?: IManagersChat;

    public static unpack(
        cfg: Config,
        dependencies: TgAdapterDependencies,
        packed: PackedTgAdapter,
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
        } as const;
    }

    private unpack(packed: PackedTgAdapter) {
        this.choir_chat_id = packed.choir_chat_id;
        this.announce_thread_id = packed.announce_thread_id;
        this.managers_chat_id = packed.managers_chat_id;
    }

    constructor(
        private cfg: Config,
        private readonly dependencies: TgAdapterDependencies,
        parent_journal: Journal,
    ) {
        super(50);
        this.journal = parent_journal.child("adapter.telegram");
        const collection = PlainCollectionFactory.create(
            cfg.users_storage,
            telegram_user_firestore_converter(),
            this.journal,
        );
        if (!collection.ok) {
            throw new Error(`telegram users collection: ${collection.error}`);
        }
        this.users_collection = collection.value;
    }

    async init(): Promise<Status> {
        try {
            const token = fs.readFileSync(this.cfg.token_file, 'utf-8');
            if (!token) {
                return Expected.err("Telegram token not found");
            }
            this.bot = new TelegramBot(token, { polling: true });
            this.bot.on("message", (msg) => {
                const status = this.handle_message(msg);
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

            const fetched = await this.users_collection.get_all();
            if (!fetched.ok) {
                return fetched.wrap_error("failed to load telegram users from storage");
            }
            for (const record of fetched.value) {
                const status = await this.raise_user_from_record(record);
                if (!status.ok) {
                    this.journal.log().warn(
                        `failed to raise telegram user ${record.telegram_id}: ${status.error}`);
                }
            }

            for (const [telegram_id, user] of this.users.entries()) {
                const status = user.init(this.bot);
                if (!status.ok) {
                    this.journal.log().error(`failed to init user: ${status.error}`);
                    this.users.delete(telegram_id);
                }
            }
            return Expected.ok(undefined);
        } catch (e) {
            return (((e) instanceof Error) ? Expected.err((e).message) : Expected.err(String(e)));
        }
    }

    async get_user_agent(user_id: string): Promise<Expected<IUserAgent>> {
        for (const user of this.users.values()) {
            if (user.userid() === user_id) {
                return Expected.ok(user);
            }
        }
        return Expected.err("user not found");
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

    protected async proceed_impl(now: Date): Promise<Expected<void[]>>
    {
        await this.users_collection.proceed(now);

        const messages = this.messages_queue;
        this.messages_queue = [];
        for (const msg of messages) {
            const status = msg.chat.type == "private"
                ? await this.process_private_message(msg)
                : await this.process_group_message(msg);
            if (!status.ok) {
                this.journal.log().warn(`failed to process message: ${status.error}`);
            }
        }

        return Expected.ok([]);
    }

    // NOTE: this function must NOT be async, it should return immediately
    private handle_message(msg: TelegramBot.Message): Status {
        if (msg.from?.id == undefined) {
            return msg.chat.type == "private"
                ? Expected.err("telegram id is undefined")
                : return_fail("telegram id is undefined", this.journal.log());
        }

        if (msg.chat.type == "private") {
            this.log_message(msg, "private");
        }

        this.messages_queue.push(msg);
        return Expected.ok(undefined);
    }

    private async process_private_message(msg: TelegramBot.Message): Promise<Status> {
        const telegram_id = msg.from?.id;
        if (telegram_id == undefined) {
            return Expected.err("telegram id is undefined");
        }

        const status = await this.get_or_create_user(
            telegram_id, msg.from?.username, msg.chat.id);
        if (!status.ok) {
            return status.wrap_error(`can't get/create user ${telegram_id}`);
        }
        status.value!.put_incoming_item({ what: "message", message: msg });
        return Expected.ok(undefined);
    }

    private async process_group_message(msg: TelegramBot.Message): Promise<Status> {
        const telegram_id = msg.from?.id;
        if (telegram_id == undefined) {
            return Expected.ok(undefined);  // just ignore
        }

        const username = msg.from?.username;
        const user_info_status = await this.resolve_group_user_info(telegram_id, username);
        if (!user_info_status.ok) {
            return user_info_status.cast_error();
        }
        const user_info = user_info_status.value;
        if (!user_info) {
            return Expected.ok(undefined);  // unknown sender without username
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
            const admin_status = await this.handle_admin_message(msg);
            if (!admin_status.ok) {
                return admin_status.wrap_error("failed to handle admin message");
            }
        }

        if (is_announce && sent_by_manager && msg.text != undefined) {
            const announce_status = await this.handle_announce_chat_message(msg);
            if (!announce_status.ok) {
                return announce_status.wrap_error("failed to handle announce chat message");
            }
            const translate_status = await Translator.translate_announce(
                user_info, msg.text!, this.journal);
            if (!translate_status.ok) {
                return translate_status.wrap_error("failed to translate announce");
            }
        }

        if (sent_to_managers_chat) {
            const managers_status = await this.handle_managers_chat_message(msg);
            if (!managers_status.ok) {
                return managers_status.wrap_error("failed to handle managers chat message");
            }
        }

        return Expected.ok(undefined);
    }

    private handle_edited_group_message(msg: TelegramBot.Message): Status {
        this.log_message(msg, "group");
        return Expected.ok(undefined);
    }

    // NOTE: this function must NOT be async, it should return immediately
    private handle_callback(query: TelegramBot.CallbackQuery): Status {
        const telegram_id = query.from?.id;
        this.journal.log().info(
            `Callback query from ${query.from?.username ?? telegram_id} in ${query.message?.chat.id}: ${query.data}`);
        if (telegram_id == undefined) {
            return Expected.err("telegram id is undefined");
        }

        let status = this.get_user(telegram_id);
        if (!status.ok) {
            return status.wrap_error(`user ${telegram_id} not found`);
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
        const telegram_id = msg.from?.id;
        if (msg.text == undefined || telegram_id == undefined) {
            // Ignoring message
            return Expected.ok(undefined);
        }

        const user = this.get_user(telegram_id);
        if (!user.ok) {
            return user.wrap_error(`can't get user ${telegram_id}`);
        }

        const message: GroupChatMessage = {
            time: new Date(msg.date * 1000),
            message_id: msg.message_id.toString(),
            user_id: user.value.userid(),
            text: msg.text,
        }

        const status = await ManagersChat.on_new_message(message);
        if (!status.ok) {
            return status;
        }

        return Expected.ok(undefined);
    }

    async handle_announce_chat_message(msg: TelegramBot.Message): Promise<Status> {
        const telegram_id = msg.from?.id;
        if (msg.text == undefined || telegram_id == undefined) {
            // Ignoring message
            return Expected.ok(undefined);
        }

        const user = this.get_user(telegram_id);
        if (!user.ok) {
            return user.wrap_error(`can't get user ${telegram_id}`);
        }

        const message: GroupChatMessage = {
            time: new Date(msg.date * 1000),
            message_id: msg.message_id.toString(),
            user_id: user.value.userid(),
            text: msg.text,
        }

        const status = await AnnouncesChat.on_new_message(message);
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

    private get_user(telegram_id: number): Expected<TelegramUser> {
        const user = this.users.get(telegram_id);
        if (user) {
            return Expected.ok(user);
        }
        return Expected.err("user not found");
    }

    private async get_or_create_user(
        telegram_id: number,
        username: string | undefined,
        chat_id: number,
    ): Promise<Expected<TelegramUser>> {
        const existing = this.users.get(telegram_id);
        if (existing) {
            const sync_status = await this.sync_existing_user(existing, telegram_id, username, chat_id);
            if (!sync_status.ok) {
                this.journal.log().warn(
                    `failed to sync telegram user ${telegram_id}: ${sync_status.error}`);
            }
            return Expected.ok(existing);
        }

        const stored = await this.users_collection.get_one(
            telegram_user_record_id(telegram_id));
        if (stored.ok) {
            const resolved = await Helpers.resolve_user_data(stored.value, username);
            if (!resolved.ok) {
                return resolved.cast_error<TelegramUser>();
            }
            const agent = await this.create_telegram_agent(
                resolved.value, telegram_id, chat_id);
            if (!agent.ok) {
                return agent;
            }
            const update_status = await this.update_record_if_changed(
                stored.value, resolved.value, telegram_id, username, chat_id);
            if (!update_status.ok) {
                this.journal.log().warn(
                    `failed to update telegram user ${telegram_id}: ${update_status.error}`);
            }
            return agent;
        }
        if (!Helpers.is_item_not_found(stored)) {
            return stored.cast_error<TelegramUser>();
        }

        // First contact: username is required to bind to UserService / sheets.
        if (username == undefined) {
            return Expected.err("username is undefined");
        }

        const resolved = await Helpers.resolve_user_data(undefined, username);
        if (!resolved.ok) {
            return resolved.cast_error<TelegramUser>();
        }

        const record: TelegramUserRecord = {
            id: telegram_user_record_id(telegram_id),
            revision: 1,
            user_id: resolved.value.id.system_id,
            telegram_username: username,
            telegram_id,
            private_chat_id: chat_id,
        };
        const created = await this.users_collection.create(record);
        if (!created.ok) {
            return created.cast_error<TelegramUser>()
                .wrap_error(`failed to store telegram user ${telegram_id}`);
        }

        return this.create_telegram_agent(resolved.value, telegram_id, chat_id);
    }

    private async raise_user_from_record(record: TelegramUserRecord): Promise<Status> {
        if (this.users.has(record.telegram_id)) {
            return Expected.ok(undefined);
        }
        const resolved = await Helpers.resolve_user_data(record, undefined);
        if (!resolved.ok) {
            return resolved.cast_error();
        }
        const agent = new TelegramUser(
            resolved.value, record.private_chat_id, this.dependencies, this.journal);
        this.users.set(record.telegram_id, agent);

        const update_status = await this.update_record_if_changed(
            record, resolved.value, record.telegram_id, undefined, record.private_chat_id);
        if (!update_status.ok) {
            this.journal.log().warn(
                `failed to sync telegram user ${record.telegram_id} on raise: ${update_status.error}`);
        }
        return Expected.ok(undefined);
    }

    private async create_telegram_agent(
        user_data: UserData,
        telegram_id: number,
        chat_id: number,
    ): Promise<Expected<TelegramUser>> {
        if (this.bot == undefined) {
            return Expected.err("bot is not initialized");
        }

        this.journal.log().info(`Creating telegram agent for ${telegram_id}...`);

        const new_user = new TelegramUser(user_data, chat_id, this.dependencies, this.journal);
        const status = new_user.init(this.bot);
        if (!status.ok) {
            return status.wrap_error("initialization error");
        }

        this.users.set(telegram_id, new_user);
        this.journal.log().info(`Telegram agent for ${telegram_id} created`);
        return Expected.ok(new_user);
    }

    private async sync_existing_user(
        user: TelegramUser,
        telegram_id: number,
        username: string | undefined,
        chat_id: number,
    ): Promise<Status> {
        const info = user.info();
        const known_username = info.id.tg_username;
        const username_changed = username != undefined && username !== known_username;
        const chat_changed = chat_id !== user.private_chat_id();
        if (!username_changed && !chat_changed) {
            return Expected.ok(undefined);
        }
        if (chat_changed) {
            user.set_private_chat_id(chat_id);
        }
        const telegram_username = username ?? known_username;
        if (telegram_username == undefined) {
            return Expected.err("telegram username is missing");
        }
        return (await this.update_user_record({
            user_id: info.id.system_id,
            telegram_username,
            telegram_id,
            private_chat_id: chat_id,
        })).as_status();
    }

    private async update_record_if_changed(
        record: TelegramUserRecord,
        user_data: UserData,
        telegram_id: number,
        username: string | undefined,
        chat_id: number,
    ): Promise<Status> {
        const telegram_username = username
            ?? record.telegram_username
            ?? user_data.id.tg_username;
        if (telegram_username == undefined) {
            return Expected.err("telegram username is missing");
        }
        return (await this.update_user_record({
            user_id: user_data.id.system_id,
            telegram_username,
            telegram_id,
            private_chat_id: chat_id,
        })).as_status();
    }

    private async update_user_record(patch: {
        user_id: string;
        telegram_username: string;
        telegram_id: number;
        private_chat_id: number;
    }): Promise<Expected<TelegramUserRecord>> {
        const id = telegram_user_record_id(patch.telegram_id);
        const existing = await this.users_collection.get_one(id);
        if (!existing.ok) {
            return existing;
        }
        if (existing.value.user_id === patch.user_id
            && existing.value.telegram_username === patch.telegram_username
            && existing.value.private_chat_id === patch.private_chat_id) {
            return existing;
        }
        return this.users_collection.update({
            id,
            user_id: patch.user_id,
            telegram_username: patch.telegram_username,
            telegram_id: patch.telegram_id,
            private_chat_id: patch.private_chat_id,
        });
    }

    private async resolve_group_user_info(
        telegram_id: number,
        username: string | undefined,
    ): Promise<Expected<UserData | undefined>> {
        if (username != undefined) {
            const resolved = await Environment.global.user_service.resolve_user({
                tg_username: username,
            });
            if (!resolved.ok) {
                return resolved.cast_error();
            }
            return Expected.ok(
                resolved.value
                    ?? await Environment.global.user_service.create_guest(username));
        }

        const agent = this.users.get(telegram_id);
        if (agent) {
            return Expected.ok(agent.info());
        }
        return Expected.ok(undefined);
    }
}

class Helpers {
    static is_item_not_found(status: Expected<unknown>): boolean {
        return !status.ok && status.error.includes("not found");
    }

    static async resolve_user_data(
        record: TelegramUserRecord | undefined,
        username: string | undefined,
    ): Promise<Expected<UserData>> {
        const service = Environment.global.user_service;

        if (!record) {
            if (username == undefined) {
                return Expected.err("username is undefined");
            }
            const by_name = await service.resolve_user({ tg_username: username });
            if (!by_name.ok) {
                return by_name.cast_error();
            }
            return Expected.ok(
                by_name.value ?? await service.create_guest(username));
        }

        const by_id = await service.resolve_user({ system_id: record.user_id });
        if (!by_id.ok) {
            return by_id.cast_error();
        }

        let user_data = by_id.value;
        const uname = username ?? record.telegram_username;
        if (uname) {
            const by_name = await service.resolve_user({ tg_username: uname });
            if (!by_name.ok) {
                return by_name.cast_error();
            }
            if (by_name.value) {
                // Prefer username match when system_id changed (guest became chorister)
                // or when stored system_id is no longer present.
                if (!user_data || by_name.value.id.system_id !== user_data.id.system_id) {
                    user_data = by_name.value;
                }
            } else if (!user_data) {
                user_data = await service.create_guest(uname);
            }
        }

        if (!user_data) {
            return Expected.err(`user ${record.user_id} not found`);
        }
        return Expected.ok(user_data);
    }
}
