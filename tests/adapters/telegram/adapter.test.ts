import assert from "node:assert/strict";
import { TestContext, afterEach, mock, test } from "node:test";

import * as TelegramBot from "node-telegram-bot-api";

import { TgAdapter } from "@src/adapters/telegram/adapter.js";
import { TgAdapterFactory } from "@src/adapters/telegram/factory.js";
import { TelegramUserRecord } from "@src/adapters/telegram/telegram_user_record.js";
import { TelegramUser } from "@src/adapters/telegram/telegram_user.js";
import { Environment } from "@src/components/environment.js";
import { MemoryJournal } from "@src/components/memory_journal.js";
import { UserService } from "@src/components/user_service.js";
import { TgAdapterConfig } from "@src/config.js";
import { Database } from "@src/database.js";
import { Language, UserData, Voice } from "@src/entities/user.js";
import { UserPatch } from "@src/interfaces/user_service.js";
import { Runtime } from "@src/runtime.js";
import { Expected } from "@src/utils/expected.js";

import { bot_config, telegram_config, telegram_settings_storage_config } from "@tests/helpers/config.js";
import { mock_collection } from "@tests/mocks/collection.js";
import { read_only_plain_collection } from "@tests/mocks/plain_collection.js";
import { emit_telegram, telegram_message, telegram_token } from "@tests/mocks/telegram.js";
import { mock_telegram_settings_storage } from "@tests/mocks/telegram_settings_storage.js";
import { mock_user_replica } from "@tests/mocks/user_replica.js";

afterEach(() => mock.restoreAll());

function token_file(t: TestContext) { return telegram_token(t).filename; }

test("Telegram adapter restores sessions and registers first contacts after startup", async t => {
    // Motivation: removing the snapshot must preserve delivery to known users
    // immediately after restart and register new contacts on demand.

    // 1. Set up a user roster, one persisted binding, and an empty runtime.
    let runtime;
    let collection;
    let reads;
    let ticks;
    const journal = new MemoryJournal();
    const member: UserData = {
        id: { system_id: "member-id", tg_username: "member" },
        name: "Member", surname: "Singer", lang: Language.EN, voice: Voice.Alto, roles: [],
    };
    const newcomer: UserData = {
        ...member, id: { system_id: "new-id", tg_username: "newcomer" }, name: "New",
    };
    {
        const previous = Runtime["instance"];
        Runtime["instance"] = undefined;
        t.after(() => { Runtime["instance"] = previous; });

        const users = new UserService(mock_collection<UserData, UserPatch>({
            async get_all() { return Expected.ok([member, newcomer]); },
        }), journal);
        assert.equal((await users.init()).ok, true);
        const environment = new Environment();
        environment.user_service = users;
        Environment.set_global(environment);

        collection = read_only_plain_collection<TelegramUserRecord>([{
            id: "123", revision: 1, user_id: "member-id",
            telegram_username: "member", private_chat_id: 456,
        }]);
        reads = mock.method(collection, "get_all");
        ticks = mock.method(collection, "proceed");
        runtime = new Runtime(bot_config(), new Database(), users, journal);
    }

    // 2. Initialize Telegram and deliver to the restored chat before user contact.
    let adapter;
    let token;
    let commands;
    {
        token = telegram_token(t);
        const menu = mock.method(TelegramBot.Api.prototype, "setChatMenuButton", async () => true);
        commands = mock.method(TelegramBot.Api.prototype, "setMyCommands", async () => true);
        const send = mock.method(TelegramBot.Api.prototype, "sendRichMessage",
            async (_params: TelegramBot.SendRichMessageParams) => ({ message_id: 1 }));
        adapter = new TgAdapter({ token_file: token.filename, formatting: "html" },
            telegram_config(), { users: runtime.get_user_service_replica() }, collection,
            mock_telegram_settings_storage({ get: async () => Expected.ok(undefined) }), journal);

        assert.equal(reads.mock.callCount(), 0);
        assert.equal(runtime.get_user_logic("member-id"), undefined);
        const initialized = await adapter.init();
        assert.equal(initialized.ok, true, initialized.ok ? undefined : initialized.error);
        assert.equal(reads.mock.callCount(), 1);
        const agent = runtime.get_user_logic("member-id")?.all_agents()[0];
        assert.ok(agent instanceof TelegramUser);
        assert.deepEqual(agent.info(), member);
        assert.equal((await agent.send_message("Reminder")).ok, true);
        assert.equal(send.mock.calls[0].arguments[0].chat_id, 456);
        assert.equal(journal.records.some(record => record.message === "Notifying all admins"), false);
        assert.deepEqual(menu.mock.calls[0].arguments, [{ menu_button: { type: "commands" } }]);
        assert.equal(commands.mock.callCount(), 0);
    }

    // 3. Maintain the collection and check that the idle user has no commands.
    const now = new Date();
    {
        assert.equal((await adapter.proceed(now)).ok, true);
        assert.deepEqual(ticks.mock.calls[0].arguments, [now]);
        const agent = runtime.get_user_logic("member-id")?.all_agents()[0];
        assert.ok(agent);
        await agent.proceed(now);
        assert.equal(commands.mock.callCount(), 0);
    }

    // 4. Receive the first private message and create a session for the new binding.
    {
        const create = mock.method(collection, "create", async (record: TelegramUserRecord) => Expected.ok(record));
        await emit_telegram(token.client(), "message", telegram_message({
            from: { id: 789, first_name: "New", is_bot: false, username: "newcomer" },
            chat: { id: 789, type: "private" },
            text: "/start",
        }));
        assert.equal((await adapter.proceed(new Date(now.getTime() + 100))).ok, true);
        assert.equal(create.mock.callCount(), 1);
        assert.equal(create.mock.calls[0].arguments[0].user_id, "new-id");
        const agent = runtime.get_user_logic("new-id")?.all_agents()[0];
        assert.ok(agent instanceof TelegramUser);
        assert.equal(agent.private_chat_id(), 789);
        const notifications = journal.records.filter(record => record.message === "Notifying all admins");
        assert.equal(notifications.length, 1);
        assert.match(String(notifications[0].fields.notification), /@newcomer.*has joined/);
    }
});

test("Telegram chat routes load from injected settings storage", async t => {
    // Motivation: stored chat and thread identifiers must reach the public
    // routes used to deliver announcements and managers' posts.

    // 1. initialize the adapter with saved settings and capture deliveries
    let adapter;
    const deliveries: { id: TelegramBot.ChatId; text: string; thread?: number }[] = [];
    const settings = { choir_chat_id: -100, announce_thread_id: 12, managers_chat_id: -200 };
    {
        mock.method(TelegramBot.Api.prototype, "sendRichMessage", async ({ chat_id, rich_message, message_thread_id }: TelegramBot.SendRichMessageParams) => {
            assert.ok(chat_id !== undefined);
            deliveries.push({ id: chat_id, text: rich_message.html!, thread: message_thread_id });
            return { message_id: deliveries.length };
        });
        adapter = new TgAdapter({ token_file: token_file(t), formatting: "html" },
            telegram_config(), { users: mock_user_replica() }, read_only_plain_collection<TelegramUserRecord>(),
            mock_telegram_settings_storage({ get: async () => Expected.ok(settings) }), new MemoryJournal());
        assert.equal((await adapter.init()).ok, true);
    }

    // 2. deliver through each restored public chat route
    {
        const announcement = await adapter.get_announcement_chat();
        const choir = await adapter.get_choir_chat();
        const managers = await adapter.get_managers_chat();
        assert.ok(announcement && choir && managers);
        assert.equal((await announcement.send_message("Announcement")).ok, true);
        assert.equal((await choir.send_message("Choir")).ok, true);
        assert.equal((await managers.send_message("Managers")).ok, true);
        assert.deepEqual(deliveries, [
            { id: -100, text: "Announcement", thread: 12 },
            { id: -100, text: "Choir", thread: undefined },
            { id: -200, text: "Managers", thread: undefined },
        ]);
    }
});

test("Telegram adapter initialization reports injected collection read failures", async t => {
    // Motivation: an unavailable user store must prevent a successful startup
    // even when storage construction has already succeeded outside the adapter.

    // 1. supply a collection whose initial user read fails
    let adapter;
    {
        const collection = read_only_plain_collection<TelegramUserRecord>();
        mock.method(collection, "get_all", async () => Expected.err("User store unavailable"));
        adapter = new TgAdapter({ token_file: token_file(t), formatting: "html" },
            telegram_config(), { users: mock_user_replica() }, collection,
            mock_telegram_settings_storage({ get: async () => Expected.ok(undefined) }), new MemoryJournal());
    }

    // 2. surface the read failure with adapter initialization context
    {
        const initialized = await adapter.init();
        assert.equal(initialized.ok, false);
        assert.match(initialized.error, /failed to load telegram users.*User store unavailable/);
    }
});

test("Telegram adapter factory returns collection configuration errors", () => {
    // Motivation: a broken user store must produce an Expected failure before
    // starting the adapter, rather than throwing from storage construction.

    // 1. configure an invalid nested collection
    let config;
    {
        config = new TgAdapterConfig({ token_file: "unused", formatting: "html",
            settings_storage: telegram_settings_storage_config(),
            users_storage: { type: "cache_aside_collection", cache_size: 10,
                underlying: { type: "google_firestore", database_id: "", collection_name: "users" } } });
    }

    // 2. reject adapter creation without throwing
    {
        const created = TgAdapterFactory.create(
            config, telegram_config(), { users: mock_user_replica() }, new MemoryJournal());
        assert.equal(created.ok, false);
        assert.match(created.error, /Failed to create Telegram users collection.*database_id/);
    }
});

test("runtime construction leaves Telegram adapter initialization to startup", async t => {
    // Motivation: creating the in-memory registry must leave Telegram storage
    // reads and configuration failures to the asynchronous startup path.

    // 1. Configure an invalid Telegram collection.
    let config;
    let users;
    let factory;
    const journal = new MemoryJournal();
    {
        const previous = Runtime["instance"];
        Runtime["instance"] = undefined;
        t.after(() => { Runtime["instance"] = previous; });
        config = bot_config({ tg_adapter: {
            token_file: "unused", formatting: "html",
            users_storage: { type: "google_firestore", database_id: "", collection_name: "users" },
            settings_storage: telegram_settings_storage_config(),
        } });
        users = new UserService(mock_collection<UserData, UserPatch>(), journal);
        factory = mock.method(TgAdapterFactory, "create");
    }

    // 2. Construct the empty runtime without constructing the Telegram adapter.
    let runtime;
    {
        runtime = new Runtime(config, new Database(), users, journal);
        assert.equal(Runtime.get_instance(), runtime);
        assert.equal(factory.mock.callCount(), 0);
        assert.deepEqual(runtime.get_users(), []);
    }

    // 3. Start the runtime and report the invalid Telegram collection.
    {
        const started = await runtime.start();
        assert.equal(started.ok, false);
        assert.match(started.error, /Failed to start Telegram adapter.*database_id/);
        assert.equal(factory.mock.callCount(), 1);
    }
});
