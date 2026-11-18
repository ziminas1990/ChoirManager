import assert from "node:assert/strict";
import { after, mock, test } from "node:test";

import * as TelegramBot from "node-telegram-bot-api";

import { ChoristerDialog } from "@src/adapters/telegram/dialogs/chorister_dialog.js";
import { TelegramUser } from "@src/adapters/telegram/telegram_user.js";
import { ChoristerStatisticsWidget } from "@src/adapters/telegram/widgets/chorister_statistics.js";
import { Environment } from "@src/components/environment.js";
import { MemoryJournal } from "@src/components/memory_journal.js";
import { Language, Role, UserData, UserId, Voice } from "@src/entities/user.js";
import { ChoristerStatisticsRequest } from "@src/interfaces/analytic_service.js";
import { CoreAPI } from "@src/use_cases/core.js";
import { GlobalFormatter, apply_interval } from "@src/utils.js";
import { Expected } from "@src/utils/expected.js";

import { telegram_config } from "@tests/helpers/config.js";
import { value } from "@tests/helpers/expected.js";
import { mock_analytic } from "@tests/mocks/analytic.js";
import { TelegramDelivery, inline_grid, mock_telegram, telegram_callback, telegram_message } from "@tests/mocks/telegram.js";
import { mock_user_replica } from "@tests/mocks/user_replica.js";
import { mock_user_service } from "@tests/mocks/user_service.js";

GlobalFormatter.init("html");
mock.method(CoreAPI, "on_new_user_agent", () => Expected.ok(undefined));
after(() => mock.restoreAll());
const journal = new MemoryJournal();

type State = {
    profile: UserData | undefined;
    minutes: number;
    queries: ChoristerStatisticsRequest[];
    messages: TelegramDelivery[];
    rich_messages: TelegramBot.SendRichMessageParams[];
    edits: TelegramBot.EditMessageTextParams[];
    deletions: { chat_id: TelegramBot.ChatId; message_id: number }[];
    answers: string[];
    access_checks: Partial<UserId>[];
    no_change: boolean;
    broken_analytic: boolean;
};

function fixture(lang = Language.EN, coverage_days = 17.25) {
    const state: State = {
        profile: {
            id: { system_id: "member-id", tg_username: "member" },
            name: "Member", surname: "Singer", lang, voice: Voice.Alto,
            roles: [Role.Chorister],
        },
        minutes: 60, queries: [], messages: [], rich_messages: [], edits: [], deletions: [], answers: [],
        access_checks: [], no_change: false, broken_analytic: false,
    };
    const environment = new Environment();
    environment.analytic_service = mock_analytic({
        async chorister_statistic_request(request) {
            assert.equal(request.system_id, state.profile!.id.system_id);
            state.queries.push({ ...request });
            if (state.broken_analytic) {
                return Expected.err("statistics unavailable");
            }
            return Expected.ok({
                period: {
                    from: new Date(Math.max(request.from.getTime(),
                        request.to.getTime() - coverage_days * 24 * 60 * 60 * 1000)),
                    to: request.to,
                },
                total_rehersals: 1,
                visited_rehersals: 1,
                last_skipped_rehersals: 0,
                total_hours: 2,
                visited_hours: state.minutes / 60,
                attendance_percent: state.minutes / 120 * 100,
                songs: [{ name: 'Long <b>piece</b> & "friends" beyond sixteen characters', ideal: 120, actual: state.minutes,
                    attendance_percent: state.minutes / 120 * 100 }],
            });
        },
    });
    environment.user_service = mock_user_service({
        async resolve_user(id) {
            state.access_checks.push(id);
            assert.deepEqual(id, { system_id: "member-id" });
            return Expected.ok(state.profile);
        },
    });
    Environment.set_global(environment);
    const bot = mock_telegram({
        async sendMessage({ chat_id, text, ...options }) {
            const message_id = state.messages.length + 100;
            state.messages.push({ chat_id, text, options, message_id });
            return { message_id };
        },
        async sendRichMessage(params) {
            const message_id = state.messages.length + 100;
            state.rich_messages.push(params);
            assert.ok(params.rich_message.html);
            state.messages.push({ chat_id: params.chat_id, text: params.rich_message.html, options: { reply_markup: params.reply_markup }, message_id });
            return { message_id };
        },
        async editMessageText(params) {
            if (state.no_change) {
                throw new Error("Bad Request: message is not modified");
            }
            assert.ok(params);
            state.edits.push(params);
            return true;
        },
        async deleteMessage({ chat_id, message_id }) {
            state.deletions.push({ chat_id, message_id });
            return true;
        },
        async answerCallbackQuery({ callback_query_id: id }) { state.answers.push(id); },
    });
    function new_session() {
        const users = mock_user_replica({ resolve_user: () => Expected.ok(state.profile) });
        const user = new TelegramUser(structuredClone(state.profile!), 123, telegram_config(), { users }, journal);
        assert.equal(user.init(bot).ok, true);
        mock.method(user, "create_callback_button", () => {
            throw new Error("statistics must not register callbacks");
        });
        return user;
    }
    return { state, environment, bot, new_session, user: new_session() };
}

async function click(context: ReturnType<typeof fixture>, data: string | undefined, message_id = 100, overrides: Partial<TelegramBot.CallbackQuery> = {}) {
    context.user.put_incoming_item({
        what: "callback",
        callback: telegram_callback({
            id: `query-${context.state.answers.length}`, data, from: { id: 123, first_name: "Member", is_bot: false },
            message: telegram_message({ message_id }),
            ...overrides,
        }),
    });
    await context.user.proceed(new Date());
}

for (const lang of [Language.EN, Language.RU]) {
    test(`new widgets have stable buttons (${lang})`, async () => {
        // Motivation: the menu must send a rich table with literal piece names
        // and durable controls arranged as three rows of two visible buttons.

        // 1. create a session and the normal chorister dialog
        let context;
        let dialog;
        {
            context = fixture(lang);
            dialog = value(ChoristerDialog.create(context.user,
                mock_user_replica({ resolve_user: () => Expected.ok(context.user.info()) }), journal, telegram_config().assistant));
        }

        // 2. request statistics through the menu
        {
            const text = "/statistics";
            assert.equal((await dialog.on_message(telegram_message({ text }))).ok, true);
        }

        // 3. verify layout, default period, and stable identifiers
        {
            const message = context.state.messages[0];
            const payload = context.state.rich_messages[0];
            assert.equal(payload.chat_id, 123);
            assert.deepEqual(inline_grid(payload).map(row => row.length), [2, 2, 2]);
            assert.doesNotMatch(message.text, /<tg-button/);
            assert.match(message.text, /<table bordered striped compact>/);
            assert.match(message.text, /<th>(Piece|Произведение)<\/th>/);
            assert.ok(message.text.includes('<td>Long &lt;b&gt;piece&lt;/b&gt; &amp; &quot;friends&quot; beyond sixteen characters</td>'));
            assert.match(message.text, /<td align="right">1\.0<\/td>/);
            assert.match(message.text, /<td align="right">2\.0<\/td>/);
            assert.match(message.text, /<td align="right">50%<\/td>/);
            assert.doesNotMatch(message.text, /<pre>|<b>piece/);
            const keyboard = inline_grid(message).flat();
            assert.deepEqual(keyboard.map(button => button.callback_data),
                ["30", "60", "90", "180", "all", "close"].map(action => `stats:v1:${action}`));
            const rows = inline_grid(message);
            assert.deepEqual(rows.map(row => row.map(button => button.callback_data)), [
                ["stats:v1:30", "stats:v1:60"],
                ["stats:v1:90", "stats:v1:180"],
                ["stats:v1:all", "stats:v1:close"],
            ]);
            assert.doesNotMatch(message.text, /style="link"/);
            assert.equal(rows[2][1].style, "danger");

            const { from, to } = context.state.queries[0];
            assert.deepEqual(from, apply_interval(to, { days: -30 }));
        }
    });
}

test("all period buttons and close survive a fresh session without widget state", async () => {
    // Motivation: Telegram retains the original messages across restarts; a new
    // session must recover actions from the payload and message alone.

    // 1. send two widgets and retain only their Telegram message data
    let context: ReturnType<typeof fixture>;
    let buttons;
    let first;
    let second;
    {
        context = fixture();
        await new ChoristerStatisticsWidget(context.user, journal).start();
        await new ChoristerStatisticsWidget(context.user, journal).start();
        [first, second] = context.state.messages;
        buttons = inline_grid(first).flat();
    }

    // 2. replace the session and change current profile and attendance data
    {
        context.user = context.new_session();
        context.state.profile = { ...context.state.profile!,
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
            const { from, to } = context.state.queries.at(-1)!;
            const end: Date = to;
            assert.ok(end.getTime() >= clicked_at && end.getTime() <= Date.now());
            assert.deepEqual(from, days ? apply_interval(end, { days: -days }) : new Date(0));
            const edit: TelegramBot.EditMessageTextParams = context.state.edits.at(-1)!;
            assert.equal(edit.message_id, first.message_id);
            assert.equal(edit.chat_id, 123);
            assert.equal(edit.text, undefined);
            assert.equal(edit.parse_mode, undefined);
            assert.deepEqual(inline_grid(edit).map(row => row.length), [2, 2, 2]);
            assert.match(edit.rich_message!.html!, /Твоя статистика посещений/);
            assert.match(edit.rich_message!.html!, /<td align="right">100%<\/td>/);
            assert.equal(inline_grid(edit).flat().length, 6);
            if (days === undefined) {
                assert.match(edit.rich_message!.html!, /за всё время \(18 дн\.\)/);
            }
        }
    }

    // 4. update the second message and close only the first
    {
        await click(context, buttons[0].callback_data, second.message_id);
        await click(context, buttons[5].callback_data, first.message_id);
        assert.equal(context.state.edits.at(-1)!.message_id, second.message_id);
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
            context.state.profile = roles ? { ...context.state.profile!, roles } : undefined;
            assert.deepEqual(context.user.info().roles, [Role.Chorister]);
        }

        // 3. press an existing statistics button
        {
            await click(context, "stats:v1:30");
        }

        // 4. verify denial without calculating or editing statistics
        {
            assert.equal(context.state.messages.length, 1);
            assert.equal(context.state.queries.length, 0);
            assert.equal(context.state.edits.length, 0);
        }
    });
}

for (const [data, overrides] of [
    ["stats:v1:31", {}], ["stats:v1:30:other", {}], ["stats:v2:30", {}],
    ["stats:v1:30", { message: undefined }],
    ["stats:v1:30", { message: { message_id: 100, date: 1, chat: { id: 456, type: "private" } } }],
    ["stats:v1:close", { from: { id: 456, first_name: "Member", is_bot: false } }],
    ["stats:v1:30", { message: { message_id: 100, date: 1, chat: { id: 123, type: "group" } } }],
] as const) {
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
            assert.equal(context.state.queries.length, 0);
            assert.equal(context.state.edits.length, 0);
            assert.equal(context.state.deletions.length, 0);
            assert.equal(context.state.answers.length, 1);
        }
    });
}

for (const failure of ["profile error", "profile exception", "analytic error", "edit error"]) {
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
            edit = context.bot.api.editMessageText;
        }

        // 2. configure a failure and click a period button
        {
            if (failure === "profile error") {
                context.environment.user_service.resolve_user = async () => Expected.err("offline");
            } else if (failure === "profile exception") {
                context.environment.user_service.resolve_user = async () => { throw new Error("offline"); };
            } else if (failure === "analytic error") {
                context.state.broken_analytic = true;
            } else {
                context.bot.api.editMessageText = async () => { throw new Error("offline"); };
            }
            await click(context, "stats:v1:60");
        }

        // 3. verify error feedback without a replacement widget
        {
            assert.equal(context.state.messages.length, 1);
            assert.deepEqual(inline_grid(context.state.messages[0]), []);
            assert.equal(context.state.edits.length, 0);
        }

        // 4. restore services and retry the same button
        {
            context.environment.user_service.resolve_user = resolve;
            context.bot.api.editMessageText = edit;
            context.state.broken_analytic = false;
            await click(context, "stats:v1:60");
            assert.equal(context.state.edits.at(-1)!.message_id, 100);
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
        assert.equal(context.state.messages.length, 0);
        assert.equal(context.state.queries.length, 2);
    }

    // 3. click a legacy random ID and verify it is ignored
    {
        await click(context, "12345678-abcdef01");
        assert.equal(context.state.messages.length, 0);
        assert.equal(context.state.queries.length, 2);
    }

    // 4. open a new widget to obtain usable buttons
    {
        context.state.no_change = false;
        assert.equal((await new ChoristerStatisticsWidget(context.user, journal).start()).ok, true);
        const keyboard = inline_grid(context.state.messages[0]).flat();
        await click(context, keyboard[0].callback_data, context.state.messages[0].message_id);
        assert.equal(context.state.edits.length, 1);
    }
});

test("a rejected rich statistics send reports failure and can be retried", async () => {
    // Motivation: a Telegram markup error must not be reported as a successful
    // statistics display or leave the user without actionable feedback.

    // 1. reject the initial Rich HTML request
    let context;
    let send;
    {
        context = fixture();
        send = context.bot.api.sendRichMessage;
        context.bot.api.sendRichMessage = async params => {
            if (params.rich_message.html?.includes("<table")) {
                throw new Error("Bad Request: unsupported rich message tag");
            }
            return send(params);
        };
    }

    // 2. check the failed outcome and Rich HTML feedback
    {
        const status = await new ChoristerStatisticsWidget(context.user, journal).start();
        assert.equal(status.ok, false);
        assert.match(status.error, /unsupported rich message tag/);
        assert.equal(context.state.rich_messages.length, 1);
        assert.equal(context.state.messages.length, 1);
        assert.match(context.state.messages[0].text, /couldn't collect statistics/);
    }

    // 3. restore delivery and open the same statistics successfully
    {
        context.bot.api.sendRichMessage = send;
        assert.equal((await new ChoristerStatisticsWidget(context.user, journal).start()).ok, true);
        assert.equal(context.state.rich_messages.length, 2);
    }
});

for (const lang of [Language.EN, Language.RU]) {
    test(`empty statistics keep controls and distinguish missing percentages (${lang})`, async () => {
        // Motivation: users with no rehearsals in the period need a usable
        // report without misleading zero percentages or an empty HTML table.

        // 1. supply a valid period with no expected attendance
        let context;
        {
            context = fixture(lang);
            context.environment.analytic_service.chorister_statistic_request = async request => Expected.ok({
                period: { from: request.to, to: request.to },
                total_rehersals: 0, visited_rehersals: 0, last_skipped_rehersals: 0,
                total_hours: 0, visited_hours: 0, attendance_percent: null, songs: [],
            });
        }

        // 2. open statistics and inspect the empty state
        {
            assert.equal((await new ChoristerStatisticsWidget(context.user, journal).start()).ok, true);
            const html = context.state.rich_messages[0].rich_message.html!;
            assert.match(html, /(No pieces for this period|За этот период нет произведений)/);
            assert.match(html, /: —<\/p>/);
            assert.doesNotMatch(html, /<table|NaN|Infinity|0%/);
            assert.equal(inline_grid(context.state.rich_messages[0]).flat().length, 6);
        }

        // 3. select all time and verify that an empty history covers zero days
        {
            await click(context, "stats:v1:all");
            const html = context.state.edits.at(-1)!.rich_message!.html!;
            assert.ok(html.includes(lang === Language.RU
                ? "за всё время (0 дн.)" : "for all time (0 days)"));
        }
    });
}

for (const [lang, coverage_days, expected] of [
    [Language.RU, 17.25, "за всё время (18 дн.)"],
    [Language.EN, 17.25, "for all time (18 days)"],
    [Language.RU, 1, "за всё время (1 дн.)"],
    [Language.EN, 1, "for all time (1 day)"],
] as const) {
    test(`all-time statistics show the actual covered days (${lang}, ${coverage_days})`, async () => {
        // Motivation: the all-time request starts at the Unix epoch, while the
        // visible day count must reflect the period returned by analytics.

        // 1. prepare statistics whose recorded history is shorter than the request
        let context;
        {
            context = fixture(lang, coverage_days);
        }

        // 2. select all time using a durable period control
        {
            await click(context, "stats:v1:all");
        }

        // 3. verify the actual duration instead of the epoch-based request span
        {
            assert.deepEqual(context.state.queries[0].from, new Date(0));
            const html = context.state.edits[0].rich_message!.html!;
            assert.ok(html.includes(expected));
        }
    });
}

for (const failure of [undefined, "replacement", "cleanup", "edit"] as const) {
    test(`legacy statistics replacement handles ${failure ?? "success"}`, async () => {
        // Motivation: embedded controls make old widgets immutable; migration
        // must deliver usable controls and preserve delivery or cleanup errors.

        // 1. simulate a retained message whose edit is rejected by Telegram
        let context;
        {
            context = fixture();
            context.bot.api.editMessageText = async () => {
                throw new Error(failure === "edit" ? "offline" : "Bad Request: message can't be edited");
            };
            if (failure === "replacement") {
                const send = context.bot.api.sendRichMessage;
                context.bot.api.sendRichMessage = async params => {
                    if (params.rich_message.html?.includes("<table")) {
                        throw new Error("replacement unavailable");
                    }
                    return send(params);
                };
            }
            if (failure === "cleanup") {
                context.bot.api.deleteMessage = async () => false;
            }
        }

        // 2. request a new period through the retained embedded callback
        let result;
        {
            result = await ChoristerStatisticsWidget.on_callback(telegram_callback({
                data: "stats:v1:60", from: { id: 123, first_name: "Member", is_bot: false },
                message: telegram_message({ message_id: 42 }),
            }), context.user, journal);
        }

        // 3. check replacement delivery and that failures remain failures
        {
            assert.equal(result.ok, failure === undefined);
            const widgets = context.state.rich_messages.filter(payload =>
                payload.rich_message.html?.includes("<table"));
            assert.equal(widgets.length, failure === "replacement" || failure === "edit" ? 0 : 1);
            if (widgets.length) {
                assert.deepEqual(inline_grid(widgets[0]).map(row => row.length), [2, 2, 2]);
                assert.doesNotMatch(widgets[0].rich_message.html!, /<tg-button/);
                assert.match(widgets[0].rich_message.html!, /last 60 days/);
            }
            assert.deepEqual(context.state.deletions,
                failure === undefined ? [{ chat_id: 123, message_id: 42 }] : []);
        }
    });
}
