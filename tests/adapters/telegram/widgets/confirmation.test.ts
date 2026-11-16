import assert from "node:assert/strict";
import * as TelegramBot from "node-telegram-bot-api";
import { after, mock, test } from "node:test";

import { TelegramCallbacks } from "@src/adapters/telegram/callbacks.js";
import { TelegramUser } from "@src/adapters/telegram/telegram_user.js";
import { FeedbackWidget } from "@src/adapters/telegram/widgets/feedback_activity.js";
import { ConfirmationError } from "@src/interfaces/user_agent.js";
import { FeedbackActions } from "@src/use_cases/feedback_actions.js";
import { ConfirmationWidget } from "@src/adapters/telegram/widgets/confirmation.js";
import { Environment } from "@src/components/environment.js";
import { MemoryJournal } from "@src/components/memory_journal.js";
import { Language, Role, UserData, Voice } from "@src/entities/user.js";
import { CoreAPI } from "@src/use_cases/core.js";
import { GlobalFormatter } from "@src/utils.js";
import { Expected } from "@src/utils/expected.js";

import { telegram_config } from "@tests/helpers/config.js";
import { TelegramDelivery, inline_grid, mock_telegram, telegram_callback } from "@tests/mocks/telegram.js";
import { mock_user_replica } from "@tests/mocks/user_replica.js";
import { mock_user_service } from "@tests/mocks/user_service.js";

mock.method(CoreAPI, "on_new_user_agent", () => Expected.ok(undefined));
after(() => mock.restoreAll());

GlobalFormatter.init("html");
const journal = new MemoryJournal();

type State = {
    user: UserData;
    messages: TelegramDelivery[];
    answers: string[];
    edits: string[];
    edit_payloads: TelegramBot.EditMessageTextParams[];
    deletions: number[];
};

function fixture(lang = Language.EN) {
    const state: State = {
        user: {
            id: { system_id: "admin-id", tg_username: "admin" },
            name: "Ada",
            surname: "Admin",
            lang,
            voice: Voice.Alto,
            roles: [Role.Admin],
        },
        messages: [],
        answers: [],
        edits: [],
        edit_payloads: [],
        deletions: [],
    };
    const environment = new Environment();
    environment.user_service = mock_user_service({
        async resolve_user() {
            return Expected.ok(state.user);
        },
    });
    Environment.set_global(environment);

    const bot = mock_telegram({
        async sendRichMessage({ chat_id, rich_message, ...options }) {
            const text = rich_message.html!;
            state.messages.push({ chat_id, text, options, message_id: state.messages.length + 1 });
            return { message_id: state.messages.length };
        },
        async answerCallbackQuery({ callback_query_id: id }) {
            state.answers.push(id);
        },
        async editMessageReplyMarkup() {
            return true;
        },
        async editMessageText(params) {
            state.edits.push(params!.rich_message!.html!);
            state.edit_payloads.push(params!);
            return true;
        },
        async deleteMessage({ message_id }) {
            state.deletions.push(message_id);
            return true;
        },
    });
    const users = mock_user_replica({ resolve_user: () => Expected.ok(state.user) });
    const user = new TelegramUser(state.user, 123, telegram_config(), { users }, journal);
    assert.equal(user.init(bot).ok, true);
    return { state, user, bot, users };
}

async function click(context: ReturnType<typeof fixture>, data: string | undefined, now = new Date()) {
    context.user.put_incoming_item({
        what: "callback",
        callback: telegram_callback({
            id: `query-${context.state.answers.length}`,
            data,
            from: { id: 456, first_name: "Member", is_bot: false },
        }),
    });
    await context.user.proceed(now);
}

test("a role change between queued clicks invalidates the remaining callbacks", async () => {
    // Motivation: an earlier callback can change roles, so later queued clicks
    // must not run saved actions with permissions that have since changed.

    // 1. create a session with an injected replica and no global user service
    let context;
    const roles_seen: Role[][] = [];
    {
        context = fixture();
        Environment.set_global(new Environment());
        assert.deepEqual(context.user.info().roles, [Role.Admin]);
    }

    // 2. register callbacks that observe roles and change the replica's profile
    let first;
    let second;
    {
        first = context.user.create_callback_button("First", "roles.first", async () => {
            roles_seen.push(context.user.info().roles);
            context.state.user = { ...context.state.user, roles: [Role.Manager] };
            return Expected.ok(undefined);
        }).callback_data;
        second = context.user.create_callback_button("Second", "roles.second", async () => {
            roles_seen.push(context.user.info().roles);
            return Expected.ok(undefined);
        }).callback_data;
    }

    // 3. process both clicks while the first changes the cached profile
    {
        context.user.put_incoming_item({ what: "callback",
            callback: telegram_callback({ id: "first", data: first, from: { id: 456, first_name: "Member", is_bot: false } }) });
        context.user.put_incoming_item({ what: "callback",
            callback: telegram_callback({ id: "second", data: second, from: { id: 456, first_name: "Member", is_bot: false } }) });
        await context.user.proceed(new Date());
    }

    // 4. verify only the first handler ran and the next event refreshed roles
    {
        assert.deepEqual(roles_seen, [[Role.Admin]]);
        assert.strictEqual(context.user.info(), context.state.user);
        assert.deepEqual(context.state.answers, ["first", "second"]);
    }
});

for (const roles of [[], [Role.Manager], [Role.Admin, Role.Chorister]]) {
    test(`saved callbacks are invalidated when roles change to ${JSON.stringify(roles)}`, async () => {
        // Motivation: losing or gaining roles must invalidate saved closures
        // before the first click, without affecting another user's buttons.

        // 1. create independent sessions with saved callback buttons
        let context;
        let unaffected;
        let old_button;
        let unaffected_button;
        let calls = 0;
        let unaffected_calls = 0;
        {
            context = fixture();
            unaffected = fixture();
            old_button = context.user.create_callback_button("Old", "old", async () => {
                calls += 1;
                return Expected.ok(undefined);
            });
            unaffected_button = unaffected.user.create_callback_button(
                "Unchanged", "unchanged", async () => {
                    unaffected_calls += 1;
                    return Expected.ok(undefined);
                });
        }

        // 2. change only the target's roles and click both existing buttons
        {
            context.state.user = { ...context.state.user, roles };
            await click(context, old_button.callback_data);
            await click(unaffected, unaffected_button.callback_data);
            assert.equal(calls, 0);
            assert.equal(unaffected_calls, 1);
            assert.equal(context.state.answers.length, 1);
        }

        // 3. restore the original roles and verify the old button stays invalid
        {
            context.state.user = { ...context.state.user, roles: [Role.Admin] };
            await click(context, old_button.callback_data);
            assert.equal(calls, 0);
        }

        // 4. issue a new button and verify the current session can use it
        {
            const button = context.user.create_callback_button("New", "new", async () => {
                calls += 1;
                return Expected.ok(undefined);
            });
            await click(context, button.callback_data);
            assert.equal(calls, 1);
            assert.equal(context.state.messages.length, 0);
        }
    });
}

for (const update of ["set_user_info", "periodic refresh"]) {
    test(`${update} invalidates old buttons and preserves newly issued buttons`, async () => {
        // Motivation: profile updates outside queue processing must invalidate
        // old callbacks immediately without clearing subsequent registrations.

        // 1. register a button and arm the periodic profile refresh
        let context;
        let old_button;
        let old_calls = 0;
        let new_calls = 0;
        const now = new Date();
        {
            context = fixture();
            await context.user.maybe_update_user_info(now);
            old_button = context.user.create_callback_button("Old", "old", async () => {
                old_calls += 1;
                return Expected.ok(undefined);
            });
        }

        // 2. update the profile through the selected path before the next event
        {
            context.state.user = { ...context.state.user, roles: [Role.Manager] };
            if (update === "set_user_info") {
                context.user.set_user_info(context.state.user);
            } else {
                await context.user.maybe_update_user_info(new Date(now.getTime() + 10_000));
            }
        }

        // 3. register a button under the new roles and try both buttons
        {
            const button = context.user.create_callback_button("New", "new", async () => {
                new_calls += 1;
                return Expected.ok(undefined);
            });
            await click(context, old_button.callback_data);
            await click(context, button.callback_data);
        }

        // 4. verify only the newly issued callback ran
        {
            assert.equal(old_calls, 0);
            assert.equal(new_calls, 1);
        }
    });
}

test("profile edits and reordered or duplicate roles preserve saved callbacks", async () => {
    // Motivation: refreshing a profile must not break working buttons when
    // permissions are unchanged, even if the role array has a different shape.

    // 1. create a session with two roles and a saved button
    let context;
    let button;
    let calls = 0;
    {
        context = fixture();
        context.state.user = { ...context.state.user, roles: [Role.Admin, Role.Manager] };
        context.user.set_user_info(context.state.user);
        button = context.user.create_callback_button("Keep", "keep", async () => {
            calls += 1;
            return Expected.ok(undefined);
        });
    }

    // 2. change profile fields and reorder the same roles with a duplicate
    {
        context.state.user = {
            ...context.state.user,
            name: "Updated",
            lang: Language.RU,
            roles: [Role.Manager, Role.Admin, Role.Manager],
        };
        await click(context, button.callback_data);
    }

    // 3. verify the profile refreshed without invalidating the callback
    {
        assert.equal(calls, 1);
        assert.strictEqual(context.user.info(), context.state.user);
    }
});

test("a click rejects an expired callback before the handler runs", async () => {
    // Motivation: registry cleanup is periodic, so a click that arrives first
    // must still refuse a callback whose valid_until has passed.

    // 1. register a callback that expires in one second
    let registry;
    let calls: number;
    let id;
    {
        registry = new TelegramCallbacks(journal);
        calls = 0;
        id = registry.add_callback({
            fn: async () => {
                calls += 1;
                return Expected.ok(undefined);
            },
            journal,
        }, 1);
    }

    // 2. deliver a click after the lifetime without running cleanup
    let status;
    {
        status = await registry.on_callback(
            telegram_callback({ id: "query", data: id }),
            new Date(Date.now() + 1_001),
        );
    }

    // 3. verify the handler did not run and the callback was dropped
    {
        assert.equal(status.ok, true);
        assert.equal(calls, 0);
        assert.equal(registry.has_callback(id), false);
    }
});

test("a click still runs a callback that has not expired", async () => {
    // Motivation: the expiry check on click must leave an in-time button able
    // to record the choice.

    // 1. register a callback with time left
    let registry;
    let calls: number;
    let id;
    {
        registry = new TelegramCallbacks(journal);
        calls = 0;
        id = registry.add_callback({
            fn: async () => {
                calls += 1;
                return Expected.ok(undefined);
            },
            journal,
        }, 3600);
    }

    // 2. deliver a click at the current time
    let status;
    {
        status = await registry.on_callback(telegram_callback({ id: "query", data: id }), new Date());
    }

    // 3. verify the handler ran and the callback remains
    {
        assert.equal(status.ok, true);
        assert.equal(calls, 1);
        assert.equal(registry.has_callback(id), true);
    }
});

test("an expired confirmation click does nothing", async () => {
    // Motivation: once valid_until has passed, the stored handler must not
    // apply the change, and the click has no reply yet.

    // 1. register a short-lived confirmation button
    let context;
    let called;
    let button;
    {
        context = fixture();
        called = false;
        button = context.user.create_callback_button(
            "Yes",
            "confirmation.positive",
            async () => {
                called = true;
                return Expected.ok(undefined);
            },
            1,
        );
    }

    // 2. click it after the lifetime
    {
        await click(context, button.callback_data, new Date(Date.now() + 1_001));
    }

    // 3. verify the handler did not run and no message was sent
    {
        assert.equal(called, false);
        assert.equal(context.state.messages.length, 0);
        assert.equal(context.state.answers.length, 1);
    }
});

test("a confirmation button from before a restart is ignored", async () => {
    // Motivation: confirmation handlers live only in memory, so a button left
    // after a restart must not run and must not send a reply yet.

    // 1. create a confirmation button, then open a new user session
    let context;
    let data;
    let called;
    {
        context = fixture();
        called = false;
        data = context.user.create_callback_button(
            "Yes",
            "confirmation.positive",
            async () => {
                called = true;
                return Expected.ok(undefined);
            },
            3600,
        ).callback_data;
        context.user = new TelegramUser(
            context.state.user, 123, telegram_config(), { users: context.users }, journal);
        assert.equal(context.user.init(context.bot).ok, true);
    }

    // 2. click the button data from the previous session
    {
        await click(context, data);
    }

    // 3. verify silence
    {
        assert.equal(called, false);
        assert.equal(context.state.messages.length, 0);
        assert.equal(context.state.answers.length, 1);
    }
});

test("a repeated confirmation click does not apply the choice again", async () => {
    // Motivation: the first click consumes the confirmation, so a second click
    // on the same button must not record another decision.

    // 1. show a confirmation and accept it once
    let context;
    let data;
    let decision;
    {
        context = fixture();
        const widget = new ConfirmationWidget(
            context.user, journal, "Add Anna?", "Yes", "No");
        assert.equal((await widget.start()).ok, true);
        data = inline_grid(context.state.messages[0])[0][0].callback_data;
        const pending = widget.answer();
        await click(context, data);
        decision = await pending;
    }

    // 2. click the same button again
    {
        await click(context, data);
    }

    // 3. verify a single positive decision and no further message
    {
        assert.equal(decision.ok, true);
        assert.equal(decision.value, "positive");
        assert.equal(context.state.messages.length, 1);
        assert.equal(context.state.answers.length, 2);
    }
});

for (const outcome of ["choice", "timeout", "edit failure"] as const) {
    test(`confirmation ${outcome} removes controls and invalidates actions`, async () => {
        // Motivation: rendered controls and registered actions must end
        // together, and a failed edit cannot produce a successful decision.

        // 1. show a prompt and record its inline callback
        let context;
        let widget;
        let data;
        {
            context = fixture();
            widget = new ConfirmationWidget(context.user, journal, "Continue?", "Yes", "No",
                outcome === "timeout" ? 0.01 : undefined);
            assert.equal((await widget.start()).ok, true);
            const grid = inline_grid(context.state.messages[0]);
            assert.deepEqual(grid.map(row => row.map(button => button.text)), [["Yes", "No"]]);
            data = grid[0][0].callback_data;
        }

        // 2. finish the interaction and inspect its outcome
        {
            if (outcome === "edit failure") {
                context.bot.api.editMessageText = async () => { throw new Error("offline"); };
            }
            if (outcome !== "timeout") {
                await click(context, data);
            }
            const answer = await widget.answer();
            assert.equal(answer.ok, outcome === "choice");
            if (outcome === "timeout") {
                assert.equal(answer.is_error(ConfirmationError.TimedOut), true);
            }
            if (outcome !== "edit failure") {
                assert.deepEqual(context.state.edits, ["Continue?"]);
                assert.deepEqual(inline_grid(context.state.edit_payloads.at(-1)!), []);
            }
        }

        // 3. replay a stale click and verify no new edits
        {
            const count = context.state.edits.length;
            await click(context, data);
            assert.equal(context.state.edits.length, count);
        }
    });
}

for (const outcome of ["cancel", "publish", "failure"] as const) {
    test(`feedback ${outcome} preserves grids and invalidates stale controls`, async () => {
        // Motivation: hidden privacy controls and completed feedback must
        // never advance a flow, including after a failed delivery or edit.

        // 1. start feedback and capture its privacy grid
        let context;
        let widget;
        let privacy;
        let registration;
        {
            context = fixture();
            widget = new FeedbackWidget(context.user, journal);
            widget.on_details_provided("A concert idea");
            registration = mock.method(FeedbackActions, "register_new_feedback", async () =>
                outcome === "failure" ? Expected.err("offline") : Expected.ok(undefined));
            assert.equal((await widget.start()).ok, true);
            privacy = inline_grid(context.state.edit_payloads.at(-1)!);
            assert.deepEqual(privacy.map(row => row.map(button => button.text)), [
                ["Send anonymously"], ["Send on behalf of my party"], ["Send on my behalf"], ["Cancel"],
            ]);
        }

        // 2. choose privacy and reject replays of the removed controls
        let confirmation;
        {
            await click(context, privacy[0][0].callback_data);
            confirmation = inline_grid(context.state.edit_payloads.at(-1)!);
            assert.deepEqual(confirmation.map(row => row.map(button => button.text)), [["Send!"], ["Cancel"]]);
            const count = context.state.edits.length;
            await click(context, privacy[2][0].callback_data);
            assert.equal(context.state.edits.length, count);
        }

        // 3. complete or fail the flow and check the visible controls
        {
            await click(context, confirmation[outcome === "cancel" ? 1 : 0][0].callback_data);
            assert.equal(widget.finished(), true);
            if (outcome === "failure") {
                assert.deepEqual(inline_grid(context.state.edit_payloads.at(-1)!), []);
            } else {
                assert.deepEqual(context.state.deletions, [1]);
            }
        }

        // 4. replay both grids and verify no duplicate publication or edit
        {
            const edits = context.state.edits.length;
            const calls = registration.mock.callCount();
            await click(context, privacy[0][0].callback_data);
            await click(context, confirmation[0][0].callback_data);
            assert.equal(registration.mock.callCount(), calls);
            assert.equal(context.state.edits.length, edits);
            registration.mock.restore();
        }
    });
}

test("a failed feedback edit ends the flow and invalidates its controls", async () => {
    // Motivation: a grid that could not be replaced must not keep actions
    // alive or allow the flow to report successful completion.

    // 1. show a details prompt and record the cancel control
    let context;
    let widget;
    let cancel;
    {
        context = fixture();
        widget = new FeedbackWidget(context.user, journal);
        assert.equal((await widget.start()).ok, true);
        cancel = inline_grid(context.state.edit_payloads.at(-1)!)[0][0].callback_data;
    }

    // 2. reject the next update and ensure the error reaches the caller
    {
        context.bot.api.editMessageText = async () => { throw new Error("offline"); };
        const status = await widget.consume_message({ message_id: 2, date: 1,
            chat: { id: 123, type: "private" }, text: "My idea" });
        assert.equal(status.ok, false);
        assert.match(status.error, /offline/);
        assert.equal(widget.finished(), true);
    }

    // 3. replay the old control and verify that it cannot change the message
    {
        await click(context, cancel);
        assert.deepEqual(context.state.deletions, []);
    }
});
