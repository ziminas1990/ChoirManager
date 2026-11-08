import assert from "node:assert/strict";
import { after, mock, test } from "node:test";

import { TelegramCallbacks } from "../dist/adapters/telegram/callbacks.js";
import { TelegramUser } from "../dist/adapters/telegram/telegram_user.js";
import { ConfirmationWidget } from "../dist/adapters/telegram/widgets/confirmation.js";
import { Environment } from "../dist/components/environment.js";
import { Language, Role, Voice } from "../dist/entities/user.js";
import { CoreAPI } from "../dist/use_cases/core.js";
import { Expected } from "../dist/utils/expected.js";

mock.method(CoreAPI, "on_new_user_agent", () => Expected.ok(undefined));
after(() => mock.restoreAll());

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const journal = { child() { return this; }, log() { return logger; } };

function fixture(lang = Language.EN) {
    const state = {
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
    };
    const environment = new Environment();
    environment.user_service = {
        async resolve_user() {
            return Expected.ok(state.user);
        },
    };
    Environment.set_global(environment);

    const bot = {
        async sendMessage(chat_id, text, options) {
            state.messages.push({ chat_id, text, options });
            return { message_id: state.messages.length };
        },
        async answerCallbackQuery(id) {
            state.answers.push(id);
        },
        async editMessageReplyMarkup() {
            return true;
        },
        async editMessageText() {
            return true;
        },
    };
    const users = { resolve_user: () => Expected.ok(state.user) };
    const user = new TelegramUser(state.user, 123, { runtime: {} }, { users }, journal);
    assert.equal(user.init(bot).ok, true);
    return { state, user, bot, users };
}

async function click(context, data, now = new Date()) {
    context.user.put_incoming_item({
        what: "callback",
        callback: {
            id: `query-${context.state.answers.length}`,
            data,
            from: { id: 456 },
        },
    });
    await context.user.proceed(now);
}

test("a role change between queued clicks invalidates the remaining callbacks", async () => {
    // Motivation: an earlier callback can change roles, so later queued clicks
    // must not run saved actions with permissions that have since changed.

    // 1. create a session with an injected replica and no global user service
    let context;
    const roles_seen = [];
    {
        context = fixture();
        Environment.set_global(new Environment());
        assert.deepEqual(context.user.info().roles, [Role.Admin]);
    }

    // 2. register callbacks that observe roles and change the replica's profile
    let first;
    let second;
    {
        first = context.user.create_keyboard_button("First", "roles.first", async () => {
            roles_seen.push(context.user.info().roles);
            context.state.user = { ...context.state.user, roles: [Role.Manager] };
            return Expected.ok(undefined);
        }).callback_data;
        second = context.user.create_keyboard_button("Second", "roles.second", async () => {
            roles_seen.push(context.user.info().roles);
            return Expected.ok(undefined);
        }).callback_data;
    }

    // 3. process both clicks while the first changes the cached profile
    {
        context.user.put_incoming_item({ what: "callback",
            callback: { id: "first", data: first, from: { id: 456 } } });
        context.user.put_incoming_item({ what: "callback",
            callback: { id: "second", data: second, from: { id: 456 } } });
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
            old_button = context.user.create_keyboard_button("Old", "old", async () => {
                calls += 1;
                return Expected.ok(undefined);
            });
            unaffected_button = unaffected.user.create_keyboard_button(
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
            const button = context.user.create_keyboard_button("New", "new", async () => {
                calls += 1;
                return Expected.ok(undefined);
            });
            await click(context, button.callback_data);
            assert.equal(calls, 1);
            assert.deepEqual(context.state.messages, []);
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
            old_button = context.user.create_keyboard_button("Old", "old", async () => {
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
            const button = context.user.create_keyboard_button("New", "new", async () => {
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
        button = context.user.create_keyboard_button("Keep", "keep", async () => {
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
    // Motivation: registry cleanup is periodic, so a click that arrives
    // first must still refuse a callback whose valid_until has passed.

    // 1. register a callback that expires in one second
    let registry;
    let calls;
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
            { id: "query", data: id },
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
    // Motivation: the expiry check on click must leave an in-time
    // button able to record the choice.

    // 1. register a callback with time left
    let registry;
    let calls;
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
        status = await registry.on_callback({ id: "query", data: id }, new Date());
    }

    // 3. verify the handler ran and the callback remains
    {
        assert.equal(status.ok, true);
        assert.equal(calls, 1);
        assert.equal(registry.has_callback(id), true);
    }
});

test("an expired confirmation click does nothing", async () => {
    // Motivation: once valid_until has passed, the stored handler must
    // not apply the change, and the click has no reply yet.

    // 1. register a short-lived confirmation button
    let context;
    let called;
    let button;
    {
        context = fixture();
        called = false;
        button = context.user.create_keyboard_button(
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
        assert.deepEqual(context.state.messages, []);
        assert.equal(context.state.answers.length, 1);
    }
});

test("a confirmation button from before a restart is ignored", async () => {
    // Motivation: confirmation handlers live only in memory, so a button
    // left after a restart must not run and must not send a reply yet.

    // 1. create a confirmation button, then open a new user session
    let context;
    let data;
    let called;
    {
        context = fixture();
        called = false;
        data = context.user.create_keyboard_button(
            "Yes",
            "confirmation.positive",
            async () => {
                called = true;
                return Expected.ok(undefined);
            },
            3600,
        ).callback_data;
        context.user = new TelegramUser(
            context.state.user, 123, { runtime: {} }, { users: context.users }, journal);
        assert.equal(context.user.init(context.bot).ok, true);
    }

    // 2. click the button data from the previous session
    {
        await click(context, data);
    }

    // 3. verify silence
    {
        assert.equal(called, false);
        assert.deepEqual(context.state.messages, []);
        assert.equal(context.state.answers.length, 1);
    }
});

test("a repeated confirmation click does not apply the choice again", async () => {
    // Motivation: the first click consumes the confirmation, so a second
    // click on the same button must not record another decision.

    // 1. show a confirmation and accept it once
    let context;
    let data;
    let decision;
    {
        context = fixture();
        const widget = new ConfirmationWidget(
            context.user, journal, "Add Anna?", "Yes", "No");
        assert.equal((await widget.start()).ok, true);
        data = context.state.messages[0].options.reply_markup
            .inline_keyboard[0][0].callback_data;
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
