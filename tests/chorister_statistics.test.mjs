import { MemoryJournal } from "../dist/components/memory_journal.js";
import assert from "node:assert/strict";
import { after, mock, test } from "node:test";

import { Environment } from "../dist/components/environment.js";
import { Language, Role, Voice } from "../dist/entities/user.js";
import { TelegramUser } from "../dist/adapters/telegram/telegram_user.js";
import { ChoristerDialog } from "../dist/adapters/telegram/dialogs/chorister_dialog.js";
import { ChoristerStatisticsWidget } from "../dist/adapters/telegram/widgets/chorister_statistics.js";
import { CoreAPI } from "../dist/use_cases/core.js";
import { Runtime } from "../dist/runtime.js";
import { GlobalFormatter, apply_interval } from "../dist/utils.js";
import { Expected } from "../dist/utils/expected.js";

GlobalFormatter.init("html");
mock.method(CoreAPI, "on_new_user_agent", () => Expected.ok(undefined));
after(() => mock.restoreAll());
const journal = new MemoryJournal();

function fixture(lang = Language.EN) {
    const state = {
        profile: {
            id: { system_id: "member-id", tg_username: "member" },
            name: "Member", surname: "Singer", lang, voice: Voice.Alto,
            roles: [Role.Chorister],
        },
        minutes: 60, queries: [], messages: [], edits: [], deletions: [], answers: [],
        access_checks: [], no_change: false, broken_database: false,
    };
    const database = {
        first_presence_date(username) {
            assert.equal(username, state.profile.id.tg_username);
            return new Date(0);
        },
        get_rehersals_in_period(begin, end) {
            if (state.broken_database) throw new Error("statistics unavailable");
            state.queries.push({ begin, end });
            return [{
                when: () => new Date(end.getTime() - 86400_000),
                minutes_of_presence(username) {
                    assert.equal(username, state.profile.id.tg_username);
                    return state.minutes;
                },
                duration(voice) {
                    assert.equal(voice, state.profile.voice);
                    return 120;
                },
                songs: () => [{ name: "Song", minutes: state.minutes }],
            }];
        },
    };
    const environment = new Environment();
    environment.user_service = {
        async resolve_user(id) {
            state.access_checks.push(id);
            assert.deepEqual(id, { system_id: "member-id" });
            return Expected.ok(state.profile);
        },
    };
    Environment.set_global(environment);
    mock.method(Runtime, "get_instance", () => ({ get_database: () => database }));
    const bot = {
        async sendMessage(chat_id, text, options) {
            const message_id = state.messages.length + 100;
            state.messages.push({ chat_id, text, options, message_id });
            return { message_id };
        },
        async editMessageText(text, options) {
            if (state.no_change) throw new Error("Bad Request: message is not modified");
            state.edits.push({ text, ...options });
            return true;
        },
        async deleteMessage(chat_id, message_id) {
            state.deletions.push({ chat_id, message_id });
            return true;
        },
        async answerCallbackQuery(id) { state.answers.push(id); },
    };
    function new_session() {
        const users = { resolve_user: () => Expected.ok(state.profile) };
        const user = new TelegramUser(structuredClone(state.profile), 123, { runtime: {} }, { users }, journal);
        assert.equal(user.init(bot).ok, true);
        mock.method(user, "wait_api_cooldown", async () => {});
        mock.method(user, "create_keyboard_button", () => {
            throw new Error("statistics must not register callbacks");
        });
        return user;
    }
    return { state, environment, bot, new_session, user: new_session() };
}

async function click(context, data, message_id = 100, overrides = {}) {
    context.user.put_incoming_item({
        what: "callback",
        callback: {
            id: `query-${context.state.answers.length}`, data, from: { id: 123 },
            message: { message_id, chat: { id: 123, type: "private" } },
            ...overrides,
        },
    });
    await context.user.proceed(new Date());
}

for (const lang of [Language.EN, Language.RU]) {
    test(`new widgets have stable buttons (${lang})`, async () => {
        // Motivation: the normal menu path must issue durable buttons without
        // changing the existing layout or relying on callback registrations.

        // 1. create a session and the normal chorister dialog
        let context;
        let dialog;
        {
            context = fixture(lang);
            dialog = new ChoristerDialog(context.user, {}, journal);
        }

        // 2. request statistics through the menu
        {
            const text = lang === Language.RU ? "Статистика" : "Statistics";
            assert.equal((await dialog.on_message({ text })).ok, true);
        }

        // 3. verify layout, default period, and stable identifiers
        {
            const message = context.state.messages[0];
            const keyboard = message.options.reply_markup.inline_keyboard;
            assert.deepEqual(keyboard.map(row => row.length), [2, 2, 2]);
            assert.deepEqual(keyboard.flat().map(button => button.callback_data),
                ["30", "60", "90", "180", "all", "close"].map(action => `stats:v1:${action}`));

            const { begin, end } = context.state.queries[0];
            assert.deepEqual(begin, apply_interval(end, { days: -30 }));
        }
    });
}

test("all period buttons and close survive a fresh session without widget state", async () => {
    // Motivation: Telegram retains the original messages across restarts;
    // a new session must recover actions from the payload and message alone.

    // 1. send two widgets and retain only their Telegram message data
    let context;
    let buttons;
    let first;
    let second;
    {
        context = fixture();
        await new ChoristerStatisticsWidget(context.user, journal).start();
        await new ChoristerStatisticsWidget(context.user, journal).start();
        [first, second] = context.state.messages;
        buttons = first.options.reply_markup.inline_keyboard.flat();
    }

    // 2. replace the session and change current profile and attendance data
    {
        context.user = context.new_session();
        context.state.profile = { ...context.state.profile,
            id: { system_id: "member-id", tg_username: "renamed" },
            voice: Voice.Tenor, lang: Language.RU, roles: [Role.Manager] };
        context.state.minutes = 120;
    }

    // 3. click each saved period button and verify a fresh calculation
    for (const [index, days] of [30, 60, 90, 180, undefined].entries()) {
        // 3.1 update the first message through the recreated session
        let clicked_at;
        {
            clicked_at = Date.now();
            await click(context, buttons[index].callback_data, first.message_id);
        }

        // 3.2 verify period bounds and edit destination
        {
            const { begin, end } = context.state.queries.at(-1);
            assert.ok(end.getTime() >= clicked_at && end.getTime() <= Date.now());
            assert.deepEqual(begin, days ? apply_interval(end, { days: -days }) : new Date(0));
            const edit = context.state.edits.at(-1);
            assert.equal(edit.message_id, first.message_id);
            assert.equal(edit.chat_id, 123);
        }
    }

    // 4. update the second message and close only the first
    {
        await click(context, buttons[0].callback_data, second.message_id);
        await click(context, buttons[5].callback_data, first.message_id);
        assert.equal(context.state.edits.at(-1).message_id, second.message_id);
        assert.deepEqual(context.state.deletions, [{ chat_id: 123, message_id: first.message_id }]);
        assert.equal(context.state.messages.length, 2);
        assert.equal(context.state.answers.length, 7);
    }
});

for (const roles of [[], [Role.Admin], undefined]) {
    test(`old buttons deny access using the current profile (${roles})`, async () => {
        // Motivation: a cached authorized Telegram session must not retain
        // statistics access when the profile loses its roles or is deleted.

        // 1. create an authorized cached session
        let context;
        {
            context = fixture();
        }

        // 2. change the authoritative profile without refreshing the session
        {
            context.state.profile = roles ? { ...context.state.profile, roles } : undefined;
            assert.deepEqual(context.user.info().roles, [Role.Chorister]);
        }

        // 3. press an existing statistics button
        {
            await click(context, "stats:v1:30");
        }

        // 4. verify denial without calculating or editing statistics
        {
            assert.equal(context.state.messages.length, 1);
            assert.deepEqual(context.state.queries, []);
            assert.deepEqual(context.state.edits, []);
        }
    });
}

for (const [data, overrides] of [
    ["stats:v1:31", {}], ["stats:v1:30:other", {}], ["stats:v2:30", {}],
    ["stats:v1:30", { message: undefined }],
    ["stats:v1:30", { message: { message_id: 100, chat: { id: 456, type: "private" } } }],
    ["stats:v1:close", { from: { id: 456 } }],
    ["stats:v1:30", { message: { message_id: 100, chat: { id: 123, type: "group" } } }],
]) {
    test(`invalid statistics callbacks are contained (${data}, ${JSON.stringify(overrides)})`, async () => {
        // Motivation: malformed or forwarded callbacks must not select a
        // different message or disclose the sender's personal statistics.

        // 1. create a session with no registered callbacks
        let context;
        {
            context = fixture();
        }

        // 2. deliver an unsupported action or invalid message context
        {
            await click(context, data, 100, overrides);
        }

        // 3. verify controlled feedback with no data access or message mutation
        {
            assert.equal(context.state.messages.length, 1);
            assert.deepEqual(context.state.queries, []);
            assert.deepEqual(context.state.edits, []);
            assert.deepEqual(context.state.deletions, []);
            assert.equal(context.state.answers.length, 1);
        }
    });
}

for (const failure of ["profile error", "profile exception", "database error", "edit error"]) {
    test(`statistics failures give feedback and allow retry (${failure})`, async () => {
        // Motivation: outages must neither expose stale statistics nor consume
        // durable buttons, so the same action can be retried after recovery.

        // 1. create a session and retain its normal service methods
        let context;
        let resolve;
        let edit;
        {
            context = fixture();
            resolve = context.environment.user_service.resolve_user;
            edit = context.bot.editMessageText;
        }

        // 2. configure a failure and click a period button
        {
            if (failure === "profile error") {
                context.environment.user_service.resolve_user = async () => Expected.err("offline");
            } else if (failure === "profile exception") {
                context.environment.user_service.resolve_user = async () => { throw new Error("offline"); };
            } else if (failure === "database error") {
                context.state.broken_database = true;
            } else {
                context.bot.editMessageText = async () => { throw new Error("offline"); };
            }
            await click(context, "stats:v1:60");
        }

        // 3. verify error feedback without a replacement widget
        {
            assert.equal(context.state.messages.length, 1);
            assert.equal(context.state.messages[0].options?.reply_markup, undefined);
            assert.deepEqual(context.state.edits, []);
        }

        // 4. restore services and retry the same button
        {
            context.environment.user_service.resolve_user = resolve;
            context.bot.editMessageText = edit;
            context.state.broken_database = false;
            await click(context, "stats:v1:60");
            assert.equal(context.state.edits.at(-1).message_id, 100);
            assert.equal(context.state.messages.length, 1);
        }
    });
}

test("repeated identical updates are harmless and legacy buttons are unavailable", async () => {
    // Motivation: repeated clicks may leave Telegram content unchanged, while
    // random callback IDs retained from older releases cannot be reconstructed.

    // 1. create a fresh session and simulate an unchanged Telegram message
    let context;
    {
        context = fixture();
        context.state.no_change = true;
    }

    // 2. click the same button twice without generating an error message
    {
        await click(context, "stats:v1:30");
        await click(context, "stats:v1:30");
        assert.deepEqual(context.state.messages, []);
        assert.equal(context.state.queries.length, 2);
    }

    // 3. click a legacy random ID and verify it is ignored
    {
        await click(context, "12345678-abcdef01");
        assert.deepEqual(context.state.messages, []);
        assert.equal(context.state.queries.length, 2);
    }

    // 4. open a new widget to obtain usable buttons
    {
        context.state.no_change = false;
        assert.equal((await new ChoristerStatisticsWidget(context.user, journal).start()).ok, true);
        const keyboard = context.state.messages[0].options.reply_markup.inline_keyboard;
        await click(context, keyboard[0][0].callback_data, context.state.messages[0].message_id);
        assert.equal(context.state.edits.length, 1);
    }
});
