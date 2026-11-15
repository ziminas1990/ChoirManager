import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import * as TelegramBot from "node-telegram-bot-api";

import { TelegramUser } from "@src/adapters/telegram/telegram_user.js";
import { TelegramCommands } from "@src/adapters/telegram/commands.js";
import { ChoristerStatisticsWidget } from "@src/adapters/telegram/widgets/chorister_statistics.js";
import { FeedbackWidget } from "@src/adapters/telegram/widgets/feedback_activity.js";
import { ChoristerAgent } from "@src/components/ai/agents/chorister_agent.js";
import { Environment } from "@src/components/environment.js";
import { MemoryJournal } from "@src/components/memory_journal.js";
import { Language, Role } from "@src/entities/user.js";
import { CoreAPI } from "@src/use_cases/core.js";
import { DepositActions } from "@src/use_cases/deposit_actions.js";
import { ScoresActions } from "@src/use_cases/scores_actions.js";
import { GlobalFormatter } from "@src/utils.js";
import { Expected } from "@src/utils/expected.js";

import { telegram_config } from "@tests/helpers/config.js";
import { user_profile } from "@tests/helpers/user.js";
import { mock_telegram, telegram_callback, telegram_message } from "@tests/mocks/telegram.js";
import { mock_user_replica } from "@tests/mocks/user_replica.js";
import { mock_user_service } from "@tests/mocks/user_service.js";

afterEach(() => mock.restoreAll());
GlobalFormatter.init("html");

test("menu commands are selected for each role and guests", () => {
    // Motivation: adding per-command roles must preserve the menu visible to
    // existing users, including guests and users with multiple roles.

    // 1. inspect menus for each individual role and a guest
    for (const roles of [[], ...Object.values(Role).map(role => [role]), [Role.Conductor, Role.Manager]]) {
        const commands = TelegramCommands.for_user(user_profile("member", { roles }));
        const member = roles.some(role => [Role.Chorister, Role.Manager, Role.Admin].includes(role));
        assert.deepEqual(commands.map(item => item.command), member
            ? ["start", "deposit", "statistics", "feedback", "scores"] : ["start"]);
        assert.ok(commands.every(item => Object.keys(item).sort().join(",") === "command,description"));
    }
});

function fixture(lang = Language.EN) {
    mock.method(CoreAPI, "on_new_user_agent", () => Expected.ok(undefined));
    const state = {
        profile: user_profile("member", { lang, roles: [Role.Chorister] }),
        commands: [] as TelegramBot.SetMyCommandsParams[],
        messages: [] as TelegramBot.SendRichMessageParams[],
        edits: [] as TelegramBot.EditMessageTextParams[],
        events: [] as string[],
        reject_commands: false,
    };
    const environment = new Environment();
    environment.user_service = mock_user_service({ resolve_user: async () => Expected.ok(state.profile) });
    Environment.set_global(environment);
    const bot = mock_telegram({
        async setMyCommands(params) {
            state.events.push("commands");
            state.commands.push(params);
            if (state.reject_commands) {
                throw new Error("Commands unavailable");
            }
            return true;
        },
        async sendRichMessage(params) {
            state.messages.push(params);
            return { message_id: state.messages.length };
        },
        async editMessageText(params) {
            assert.ok(params);
            state.edits.push(params);
            return true;
        },
        async deleteMessage() { return true; },
        async answerCallbackQuery() { state.events.push("callback"); },
    });
    const users = mock_user_replica({ resolve_user: () => Expected.ok(state.profile) });
    const user = new TelegramUser(state.profile, 123, telegram_config(), { users }, new MemoryJournal());
    assert.equal(user.init(bot).ok, true);
    async function send(text?: string) {
        user.put_incoming_item({ what: "message", message: telegram_message({ text }) });
        await user.proceed(new Date(0));
    }
    return { state, user, bot, send };
}

for (const lang of [Language.EN, Language.RU]) {
    test(`private menu uses the profile language without sending messages (${lang})`, async () => {
        // Motivation: navigation must be available independently of replies,
        // using the application's language rather than the Telegram locale.

        // 1. create a private Telegram user with the selected profile language
        let context;
        {
            context = fixture(lang);
        }

        // 2. leave an idle user without a personalized menu
        {
            await context.user.proceed(new Date(0));
            await context.user.proceed(new Date(20000));
            assert.deepEqual(context.state.commands, []);
        }

        // 3. register the menu on the first incoming non-text message
        {
            await context.send();
            assert.deepEqual(context.state.commands, [{
                scope: { type: "chat", chat_id: 123 },
                commands: [
                    { command: "start", description: lang === Language.RU ? "🔄 Начать разговор заново" : "🔄 Restart conversation" },
                    { command: "deposit", description: lang === Language.RU ? "💰 Мой депозит" : "💰 My deposit" },
                    { command: "statistics", description: lang === Language.RU ? "📊 Статистика" : "📊 Statistics" },
                    { command: "feedback", description: lang === Language.RU ? "💬 Обратная связь" : "💬 Leave a feedback" },
                    { command: "scores", description: lang === Language.RU ? "🎼 Скачать ноты" : "🎼 Download scores" },
                ],
            }]);
            assert.deepEqual(context.state.messages, []);
        }

        // 4. keep subsequent ticks and messages free of redundant updates
        {
            await context.user.proceed(new Date(0));
            await context.send();
            assert.equal(context.state.commands.length, 1);
        }
    });

    test(`menu commands invoke existing actions before waiting widgets (${lang})`, async () => {
        // Motivation: selecting navigation during feedback must perform the
        // action, while ordinary text must still reach the active widget.

        // 1. create a session and observe the existing domain entry points
        let context;
        let deposit;
        let scores;
        let statistics;
        let consumed;
        let interrupted;
        let assistant;
        {
            context = fixture(lang);
            deposit = mock.method(DepositActions, "deposit_requested", async () => Expected.ok(undefined));
            scores = mock.method(ScoresActions, "scores_list_requested", async () => Expected.ok(undefined));
            statistics = mock.method(ChoristerStatisticsWidget.prototype, "start", async () => Expected.ok(undefined));
            consumed = mock.method(FeedbackWidget.prototype, "consume_message");
            interrupted = mock.method(FeedbackWidget.prototype, "interrupt");
            assistant = mock.method(ChoristerAgent.prototype, "send_message", async () => Expected.ok(undefined));
        }

        // 2. start the actual feedback widget through the command
        {
            await context.send("/feedback");
            assert.equal(context.state.messages.length, 1);
            assert.match(context.state.edits.at(-1)!.rich_message!.html!,
                lang === Language.RU ? /Расскажи, чем хочешь поделиться/ : /Tell me what you want to share/);
        }

        // 3. use navigation while the widget is waiting for text
        {
            await context.send("/deposit");
            await context.send("/scores@choir_bot");
            await context.send("/statistics");
            assert.equal(deposit.mock.callCount(), 1);
            assert.equal(scores.mock.callCount(), 1);
            assert.equal(statistics.mock.callCount(), 1);
            assert.strictEqual(deposit.mock.calls[0].arguments[0], context.user);
            assert.strictEqual(scores.mock.calls[0].arguments[0], context.user);
            assert.equal(consumed.mock.callCount(), 0);
        }

        // 4. restart with a deep-link argument and interrupt the widget
        {
            await context.send("/start@choir_bot invitation");
            assert.equal(interrupted.mock.callCount(), 1);
            assert.equal(context.state.messages.length, 2);
            assert.match(context.state.messages.at(-1)!.rich_message.html!,
                lang === Language.RU ? /Привет, Member/ : /Hello, Member/);
        }

        // 5. send ordinary text to a fresh feedback widget
        {
            await context.send("/feedback");
            await context.send("Please add another rehearsal");
            assert.equal(consumed.mock.callCount(), 1);
            assert.equal(consumed.mock.calls[0].arguments[0].text, "Please add another rehearsal");
            assert.equal(assistant.mock.callCount(), 0);
            assert.match(context.state.edits.at(-1)!.rich_message!.html!, /Please add another rehearsal/);
            assert.ok(context.state.messages.every(message =>
                JSON.stringify(message.reply_markup) === JSON.stringify({ remove_keyboard: true })));
        }

        // 6. accept retained keyboard buttons during migration
        {
            await context.send(lang === Language.RU ? "Мой депозит" : "My deposit");
            await context.send(lang === Language.RU ? "Скачать ноты" : "Download scores");
            await context.send(lang === Language.RU ? "Статистика" : "Statistics");
            await context.send(lang === Language.RU ? "Обратная связь" : "Leave a feedback");
            await context.send("🔄");
            assert.equal(deposit.mock.callCount(), 2);
            assert.equal(scores.mock.callCount(), 2);
            assert.equal(statistics.mock.callCount(), 2);
            assert.equal(interrupted.mock.callCount(), 3);
        }

        // 7. resume the assistant after restarting the dialog
        {
            await context.send("Hello again");
            assert.equal(assistant.mock.callCount(), 1);
            assert.equal(assistant.mock.calls[0].arguments[0], "Hello again");
        }
    });
}

test("idle profile changes and outgoing messages do not activate menu registration", async () => {
    // Motivation: restoring many users or sending notifications must not
    // cause personalized API calls before those users contact the bot.

    // 1. create an idle session and change its profile and destination
    let context;
    {
        context = fixture();
        context.state.profile = { ...context.state.profile, lang: Language.RU, roles: [] };
        context.user.set_user_info(context.state.profile);
        context.user.set_private_chat_id(456);
    }

    // 2. deliver a notification and maintain the user without registering
    {
        assert.equal((await context.user.send_message("Reminder")).ok, true);
        await context.user.proceed(new Date(0));
        await context.user.proceed(new Date(20000));
        assert.deepEqual(context.state.commands, []);
        assert.equal(context.state.messages.length, 1);
    }

    // 3. register the current menu when the user clicks an existing message
    {
        context.user.put_incoming_item({ what: "callback", callback: telegram_callback() });
        await context.user.proceed(new Date(20000));
        assert.deepEqual(context.state.commands, [{
            scope: { type: "chat", chat_id: 456 },
            commands: [{ command: "start", description: "🔄 Начать разговор заново" }],
        }]);
        assert.deepEqual(context.state.events, ["commands", "callback"]);
        assert.equal(context.state.messages.length, 1);
    }
});

test("menus follow profile language, membership, chat changes and session restoration", async () => {
    // Motivation: Telegram persists menus independently of process memory;
    // profile updates and restored sessions must publish the current menu.

    // 1. register an English menu for the initial session
    let context;
    {
        context = fixture();
        await context.send();
    }

    // 2. update the language when the next incoming activity arrives
    {
        context.state.profile = { ...context.state.profile, lang: Language.RU };
        await context.user.proceed(new Date(20000));
        assert.equal(context.state.commands.length, 1);
        await context.send();
        assert.equal(context.state.commands.length, 2);
        assert.equal(context.state.commands.at(-1)!.commands[1].description, "💰 Мой депозит");
        assert.deepEqual(context.state.messages, []);
    }

    // 3. revoke membership and keep the guest menu limited to starting
    {
        context.state.profile = { ...context.state.profile, roles: [] };
        context.user.set_user_info(context.state.profile);
        context.user.put_incoming_item({ what: "callback", callback: telegram_callback() });
        await context.user.proceed(new Date(0));
        assert.deepEqual(context.state.commands.at(-1)!.commands.map(item => item.command), ["start"]);
    }

    // 4. restore membership and register the menu at the current destination
    {
        context.state.profile = { ...context.state.profile, roles: [Role.Manager] };
        context.user.set_user_info(context.state.profile);
        context.user.set_private_chat_id(456);
        context.user.put_incoming_item({ what: "callback", callback: telegram_callback() });
        await context.user.proceed(new Date(0));
        assert.deepEqual(context.state.commands.at(-1)!.scope, { type: "chat", chat_id: 456 });
        assert.equal(context.state.commands.at(-1)!.commands.length, 5);
    }

    // 5. restore the agent without publishing a personalized menu
    let restored;
    let count;
    let messages;
    {
        restored = new TelegramUser(context.state.profile, 456, telegram_config(),
            { users: mock_user_replica({ resolve_user: () => Expected.ok(context.state.profile) }) }, new MemoryJournal());
        assert.equal(restored.init(context.bot).ok, true);
        count = context.state.commands.length;
        messages = context.state.messages.length;
        await restored.proceed(new Date(0));
        assert.equal(context.state.commands.length, count);
        assert.equal(context.state.messages.length, messages);
    }

    // 6. publish the restored user's menu only after new incoming activity
    {
        restored.put_incoming_item({ what: "message", message: telegram_message() });
        await restored.proceed(new Date(0));
        assert.equal(context.state.commands.length, count + 1);
        assert.equal(context.state.messages.length, messages);
    }
});

test("failed menu registration can be retried without blocking conversation", async () => {
    // Motivation: an unavailable menu API must not lose user input or mark
    // unpublished commands as successfully registered.

    // 1. create a session whose menu API rejects updates
    let context;
    {
        context = fixture();
        context.state.reject_commands = true;
    }

    // 2. process a command even though publishing its menu fails
    {
        await context.send("/start");
        assert.equal(context.state.messages.length, 1);
        assert.equal(context.state.commands.length, 1);
    }

    // 3. recover the API and respect the retry interval
    {
        context.state.reject_commands = false;
        await context.user.proceed(new Date(0));
        assert.equal(context.state.commands.length, 1);
        await context.user.proceed(new Date(30000));
        assert.equal(context.state.commands.length, 1);
        context.user.put_incoming_item({ what: "callback", callback: telegram_callback() });
        await context.user.proceed(new Date(30000));
        assert.equal(context.state.commands.length, 2);
        assert.deepEqual(context.state.commands[0], context.state.commands[1]);
    }

    // 4. avoid further calls once registration succeeds
    {
        await context.user.proceed(new Date(0));
        assert.equal(context.state.commands.length, 2);
    }
});
