import assert from "node:assert/strict";
import { TestContext, afterEach, mock, test } from "node:test";

import TelegramBot from "node-telegram-bot-api";

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
import { CoreAPI } from "@src/use_cases/core.js";
import { Expected } from "@src/utils/expected.js";

import { bot_config, telegram_config } from "@tests/helpers/config.js";
import { mock_collection } from "@tests/mocks/collection.js";
import { read_only_plain_collection } from "@tests/mocks/plain_collection.js";
import { telegram_token } from "@tests/mocks/telegram.js";
import { mock_user_replica } from "@tests/mocks/user_replica.js";
import { mock_user_service } from "@tests/mocks/user_service.js";

afterEach(() => mock.restoreAll());

function token_file(t: TestContext) { return telegram_token(t).filename; }

test("Telegram adapter loads and registers users from an injected collection", async t => {
    // Motivation: supplying a collection must preserve user reconstruction and
    // collection maintenance without needing a storage factory override.

    // 1. supply a saved Telegram binding and its corresponding domain user
    let collection;
    let user;
    let registration;
    let reads;
    let ticks;
    {
        user = { id: { system_id: "member-id", tg_username: "member" },
            name: "Member", surname: "Singer", lang: Language.EN,
            voice: Voice.Alto, roles: [] };
        collection = read_only_plain_collection([{
            id: "123", revision: 1, user_id: "member-id",
            telegram_username: "member", private_chat_id: 456,
        }]);
        reads = mock.method(collection, "get_all");
        ticks = mock.method(collection, "proceed");
        registration = mock.method(CoreAPI, "on_new_user_agent", () => Expected.ok(undefined));
        const environment = new Environment();
        environment.user_service = mock_user_service({
            async resolve_user(id) {
                assert.deepEqual(id, { system_id: "member-id" });
                return Expected.ok(user);
            },
        });
        Environment.set_global(environment);
    }

    // 2. initialize the adapter and observe the reconstructed user agent
    let adapter;
    {
        adapter = new TgAdapter({ token_file: token_file(t), formatting: "html" },
            telegram_config(), { users: mock_user_replica() }, collection, new MemoryJournal());
        assert.equal(reads.mock.callCount(), 0);
        const initialized = await adapter.init();
        assert.equal(initialized.ok, true, initialized.ok ? undefined : initialized.error);
        assert.equal(reads.mock.callCount(), 1);
        assert.equal(registration.mock.callCount(), 1);
        const [id, agent] = registration.mock.calls[0].arguments;
        assert.equal(id, "member-id");
        assert.ok(agent instanceof TelegramUser);
        assert.deepEqual(agent.info(), user);
        assert.equal(agent.private_chat_id(), 456);
    }

    // 3. maintain the same injected collection during adapter processing
    {
        const now = new Date();
        assert.equal((await adapter.proceed(now)).ok, true);
        assert.deepEqual(ticks.mock.calls[0].arguments, [now]);
    }
});

test("restored Telegram chat routes work with an injected collection", async t => {
    // Motivation: changing restoration dependencies must preserve stored chat
    // and thread identifiers used to deliver announcements and managers' posts.

    // 1. restore the adapter and capture outgoing Telegram deliveries
    let adapter;
    const deliveries: { id: TelegramBot.ChatId; text: string; thread?: number }[] = [];
    const packed = { choir_chat_id: -100, announce_thread_id: 12, managers_chat_id: -200 };
    {
        mock.method(TelegramBot.prototype, "sendMessage", async (id: TelegramBot.ChatId, text: string, options?: TelegramBot.SendMessageOptions) => {
            deliveries.push({ id, text, thread: options?.message_thread_id });
            return { message_id: deliveries.length };
        });
        adapter = TgAdapter.unpack({ token_file: token_file(t), formatting: "html" },
            telegram_config(), { users: mock_user_replica() }, read_only_plain_collection<TelegramUserRecord>(), packed, new MemoryJournal());
        assert.equal((await adapter.init()).ok, true);
        assert.deepEqual(TgAdapter.pack(adapter), packed);
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
            telegram_config(), { users: mock_user_replica() }, collection, new MemoryJournal());
    }

    // 2. surface the read failure with adapter initialization context
    {
        const initialized = await adapter.init();
        assert.equal(initialized.ok, false);
        assert.match(initialized.error, /failed to load telegram users.*User store unavailable/);
    }
});

test("Telegram adapter factory returns collection configuration errors in both creation modes", () => {
    // Motivation: a broken user store must produce an Expected failure before
    // either starting a new adapter or restoring saved routing information.

    // 1. configure an invalid nested collection
    let config;
    {
        config = new TgAdapterConfig({ token_file: "unused", formatting: "html",
            users_storage: { type: "cache_aside_collection", cache_size: 10,
                underlying: { type: "google_firestore", database_id: "", collection_name: "users" } } });
    }

    // 2. reject new and restored adapters without throwing
    for (const packed of [undefined, { managers_chat_id: -200 }]) {
        const created = TgAdapterFactory.create(config, telegram_config(), { users: mock_user_replica() }, new MemoryJournal(), packed);
        assert.equal(created.ok, false);
        assert.match(created.error, /Failed to create Telegram users collection.*database_id/);
    }
});

test("runtime restoration reports collection errors and can retry with valid configuration", () => {
    // Motivation: failed adapter assembly must not leave a runtime singleton
    // behind or lose restored chat routes when configuration is corrected.

    // 1. fail restoration before a runtime can be registered
    const storage = { type: "google_firestore" as const, database_id: "", collection_name: "users" };
    const config = bot_config({ tg_adapter: { token_file: "unused", formatting: "html", users_storage: storage } });
    const users = new UserService(mock_collection<UserData, UserPatch>(), new MemoryJournal());
    const packed: ReturnType<typeof Runtime.pack> = { version: 4, users: [], tg_adapter: {
        choir_chat_id: -100, announce_thread_id: 12, managers_chat_id: -200,
    } };
    const journal = new MemoryJournal();
    {
        const restored = Runtime.unpack(config, new Database(), users, packed, journal);
        assert.equal(restored.ok, false);
        assert.match(restored.error, /Failed to restore Telegram adapter.*database_id/);
        assert.throws(() => Runtime.get_instance(), /Runtime is not initialized/);
    }

    // 2. correct the store and restore routing without contacting Firestore
    {
        storage.database_id = "test";
        const restored = Runtime.unpack(config, new Database(), users, packed, journal);
        assert.equal(restored.ok, true, restored.ok ? undefined : restored.error);
        assert.equal(Runtime.get_instance(), restored.value);
        assert.deepEqual(Runtime.pack(restored.value), packed);
    }
});
