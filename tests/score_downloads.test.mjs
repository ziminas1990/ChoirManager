import { MemoryJournal } from "../dist/components/memory_journal.js";
import assert from "node:assert/strict";
import { after, mock, test } from "node:test";

import { Environment } from "../dist/components/environment.js";
import { Score } from "../dist/entities/score.js";
import { Language, Role, Voice } from "../dist/entities/user.js";
import { ChoristerDialog } from "../dist/adapters/telegram/dialogs/chorister_dialog.js";
import { ScoreDownloads } from "../dist/adapters/telegram/score_downloads.js";
import { TelegramUser } from "../dist/adapters/telegram/telegram_user.js";
import { CoreAPI } from "../dist/use_cases/core.js";
import { ScoresActions } from "../dist/use_cases/scores_actions.js";
import { GlobalFormatter } from "../dist/utils.js";
import { Expected } from "../dist/utils/expected.js";

GlobalFormatter.init("html");
mock.method(CoreAPI, "on_new_user_agent", () => Expected.ok(undefined));
after(() => mock.restoreAll());

const journal = new MemoryJournal();

function fixture(lang = Language.EN) {
    const rendered_links = new Map();
    mock.method(GlobalFormatter.instance(), "link", (_label, file) => {
        const token = `download-${rendered_links.size}`;
        rendered_links.set(token, file);
        return token;
    });
    const state = {
        user: {
            id: { system_id: "member-id", tg_username: "member" },
            name: "Member", surname: "Singer", lang, voice: Voice.Alto,
            roles: [Role.Chorister],
        },
        catalog: [
            new Score("Song", "Author", "", 60, "https://example.org/score.pdf"),
            new Score("Song", "Other author", "", 60, "https://example.org/other.pdf"),
        ],
        messages: [], answers: [], access_checks: [],
    };
    const environment = new Environment();
    environment.user_service = {
        async resolve_user(id) {
            state.access_checks.push(id);
            assert.equal(id.system_id, "member-id");
            return Expected.ok(state.user);
        },
    };
    environment.scores_service = {
        async fetch_all() { return state.catalog; },
        async get(key) { return Expected.ok(state.catalog.find(score => score.get_key() === key)); },
    };
    Environment.set_global(environment);

    const bot = {
        async sendMessage(chat_id, text, options) {
            state.messages.push({ chat_id, options, file: rendered_links.get(text) });
            return { message_id: state.messages.length };
        },
        async answerCallbackQuery(id) { state.answers.push(id); },
    };
    const users = { resolve_user: () => Expected.ok(state.user) };
    const user = new TelegramUser(state.user, 123, { runtime: {} }, { users }, journal);
    assert.equal(user.init(bot).ok, true);
    return { state, environment, bot, user, rendered_links };
}

async function click(context, data, now = new Date()) {
    context.user.put_incoming_item({
        what: "callback",
        callback: { id: `query-${context.state.answers.length}`, data, from: { id: 456 } },
    });
    await context.user.proceed(now);
}

function assert_no_link(state) {
    assert.ok(state.messages.length > 0);
    for (const message of state.messages) {
        assert.equal(message.file, undefined);
    }
}

test("downloads resolve the current file link instead of retaining the old one", async () => {
    // Motivation: Telegram must resolve a button against the current catalog
    // so an earlier list cannot distribute a superseded file link.

    // 1. create a user, catalog, and download button
    let context;
    let data;
    {
        context = fixture();
        data = ScoreDownloads.create_button(context.state.catalog[0]).callback_data;
    }

    // 2. replace the catalog entry with a new file link
    {
        context.state.catalog[0] = new Score(
            "Song", "Author", "", 60, "https://example.org/replaced.pdf");
    }

    // 3. click the previously created button
    {
        await click(context, data);
    }

    // 4. verify that only the current file link is delivered
    {
        assert.equal(context.state.messages[0].file, "https://example.org/replaced.pdf");
    }
});

for (const missing_file of [false, true]) {
    test(`unavailable scores send feedback without a download (${missing_file ? "file removed" : "score removed"})`, async () => {
        // Motivation: an obsolete selection must produce feedback without
        // sending a different author's score with the same title.

        // 1. create a user, catalog, and download button
        let context;
        let data;
        {
            context = fixture();
            data = ScoreDownloads.create_button(context.state.catalog[0]).callback_data;
        }

        // 2. make the selected score unavailable
        if (missing_file) {
            context.state.catalog[0] = new Score("Song", "Author", "", 60);
        } else {
            context.state.catalog.shift();
        }

        // 3. click the previously created button
        {
            await click(context, data);
        }

        // 4. verify feedback without a download
        {
            assert_no_link(context.state);
        }
    });
}

test("revoked permissions are checked even while the Telegram user still has cached roles", async () => {
    // Motivation: Telegram's cached profile must not preserve download access
    // after the authoritative user service revokes the user's roles.

    // 1. create an authorized user and a download button
    let context;
    let data;
    {
        context = fixture(Language.RU);
        data = ScoreDownloads.create_button(context.state.catalog[0]).callback_data;
    }

    // 2. use the button while the user is authorized
    {
        await click(context, data);
    }

    // 3. revoke roles while retaining the cached Telegram profile
    {
        context.state.messages = [];
        context.state.user = { ...context.state.user, roles: [] };
        assert.deepEqual(context.user.info().roles, [Role.Chorister]);
    }

    // 4. click the same button after access has been revoked
    {
        await click(context, data);
    }

    // 5. verify denial feedback without a download
    {
        assert_no_link(context.state);
    }
});

test("a deleted user cannot download from an existing button", async () => {
    // Motivation: a surviving Telegram session must not grant score access
    // when its user no longer exists in the authoritative user service.

    // 1. create a user and a download button
    let context;
    let data;
    {
        context = fixture();
        data = ScoreDownloads.create_button(context.state.catalog[0]).callback_data;
    }

    // 2. remove the user from the user service
    {
        context.state.user = undefined;
    }

    // 3. click the existing button
    {
        await click(context, data);
    }

    // 4. verify denial feedback without a download
    {
        assert_no_link(context.state);
    }
});

for (const failure of ["service disabled", "access lookup fails", "access lookup throws", "catalog lookup throws"]) {
    test(`${failure} produces feedback without a download`, async () => {
        // Motivation: service outages must produce Telegram feedback
        // instead of silently failing or exposing a cached download link.

        // 1. create a user, catalog, and download button
        let context;
        let data;
        {
            context = fixture();
            data = ScoreDownloads.create_button(context.state.catalog[0]).callback_data;
        }

        // 2. configure the selected service failure
        if (failure === "service disabled") {
            context.environment.scores_service = undefined;
        } else if (failure === "access lookup fails") {
            context.environment.user_service.resolve_user = async () => Expected.err("offline");
        } else if (failure === "access lookup throws") {
            context.environment.user_service.resolve_user = async () => { throw new Error("offline"); };
        } else {
            context.environment.scores_service.fetch_all = async () => { throw new Error("offline"); };
        }

        // 3. request a download during the failure
        {
            await click(context, data);
        }

        // 4. verify feedback without a download
        {
            assert_no_link(context.state);
        }
    });
}

test("a failed link delivery allows retrying the same button", async () => {
    // Motivation: a temporary Telegram delivery failure must not consume the
    // download button, so the user can recover by retrying the same action.

    // 1. create a user, download button, and failing link delivery
    let context;
    let send;
    let data;
    {
        context = fixture();
        send = context.bot.sendMessage;
        context.bot.sendMessage = async (...args) => {
            if (context.rendered_links.has(args[1])) {
                throw new Error("send failed");
            }
            return send(...args);
        };
        data = ScoreDownloads.create_button(context.state.catalog[0]).callback_data;
    }

    // 2. attempt delivery and verify failure feedback
    {
        await click(context, data);
        assert_no_link(context.state);
    }

    // 3. restore Telegram delivery
    {
        context.bot.sendMessage = send;
    }

    // 4. retry the same button and verify successful delivery
    {
        await click(context, data);
        assert.equal(context.state.messages[1].file, "https://example.org/score.pdf");
    }
});

test("a periodic profile refresh failure still lets a button report download failure", async () => {
    // Motivation: background profile refresh and callback handling share a
    // processing cycle; a refresh outage must not suppress download feedback.

    // 1. create a user and a download button
    let context;
    let data;
    {
        context = fixture();
        data = ScoreDownloads.create_button(context.state.catalog[0]).callback_data;
    }

    // 2. schedule a periodic profile refresh
    {
        await context.user.proceed(new Date());
    }

    // 3. make the user service unavailable
    {
        context.environment.user_service.resolve_user = async () => {
            throw new Error("offline");
        };
    }

    // 4. click the button when the refresh is due
    {
        await click(context, data, new Date(Date.now() + 11_000));
    }

    // 5. verify that the callback still produces failure feedback
    {
        assert_no_link(context.state);
    }
});

for (const data of ["old-handler-id", "score:v2:unknown", undefined]) {
    test(`unhandled button data stays silent (${data})`, async () => {
        // Motivation: a click that matches no known action has no reply
        // yet, so routing must acknowledge it without sending a message.

        // 1. create a user with an empty callback registry
        let context;
        {
            context = fixture();
        }

        // 2. click a button whose data cannot resolve to a usable action
        {
            await click(context, data);
        }

        // 3. verify acknowledgement without a message
        {
            assert.deepEqual(context.state.messages, []);
            assert.equal(context.state.answers.length, 1);
        }
    });
}

test("unrecognized current score button data sends feedback without a download", async () => {
    // Motivation: a current score button that names a missing file must
    // produce feedback without sending some other score.

    // 1. create a user with an empty callback registry
    let context;
    {
        context = fixture();
    }

    // 2. click a current score button whose id is not in the catalog
    {
        await click(context, "score:v1:invalid");
    }

    // 3. verify acknowledgement and feedback without a download
    {
        assert_no_link(context.state);

        assert.equal(context.state.answers.length, 1);
    }
});

test("registered callbacks retain their behavior", async () => {
    // Motivation: permanent score routing shares the Telegram callback entry
    // point with registered actions and must not consume or bypass them.

    // 1. create a user and register an ordinary callback
    let context;
    let called = 0;
    let button;
    {
        context = fixture();
        button = context.user.create_keyboard_button("Action", "existing action", async () => {
            ++called;
            return Expected.ok(undefined);
        }, 3600);
    }

    // 2. click the registered button twice
    {
        await click(context, button.callback_data);
        await click(context, button.callback_data);
    }

    // 3. verify both invocations without obsolete-button feedback
    {
        assert.equal(called, 2);
        assert.deepEqual(context.state.messages, []);
        assert.equal(context.state.answers.length, 2);
    }
});

test("answerCallbackQuery failure does not prevent downloading", async () => {
    // Motivation: Telegram may reject acknowledgement of a delayed query;
    // that transport failure must not block the actual score download.

    // 1. create a user whose callback acknowledgements fail
    let context;
    {
        context = fixture();
        context.bot.answerCallbackQuery = async () => {
            throw new Error("query is too old");
        };
    }

    // 2. click a valid score button despite the acknowledgement failure
    {
        const data = ScoreDownloads.create_button(context.state.catalog[0]).callback_data;
        await click(context, data);
    }

    // 3. verify that the score link is delivered
    {
        assert.equal(context.state.messages[0].file, "https://example.org/score.pdf");
    }
});

test("existing Score and title or filename requests use current catalog entries", async () => {
    // Motivation: the shared download use case also serves existing callers;
    // their request formats must remain valid without trusting stale objects.

    // 1. create a user and retain the original score object
    let context;
    let old_score;
    {
        context = fixture();
        old_score = context.state.catalog[0];
    }

    // 2. replace the score's file link in the catalog
    {
        context.state.catalog[0] = new Score(
            "Song", "Author", "", 60, "https://example.org/new.pdf");
    }

    // 3. request the score using each supported existing format
    for (const request of [old_score, "Song", "https://example.org/new.pdf"]) {
        // 3.1 request a download through the shared use case
        let status;
        {
            status = await ScoresActions.download_scores_request(
                context.user, request, journal);
        }

        // 3.2 verify that the current file link is delivered
        {
            assert.equal(status.ok, true);
            assert.equal(context.state.messages.at(-1).file, "https://example.org/new.pdf");
        }
    }

    // 4. remove the score from the catalog
    {
        context.state.catalog.shift();
    }

    // 5. verify that the retained score object cannot deliver a removed file
    {
        const status = await ScoresActions.download_scores_request(
            context.user, old_score, journal);
        assert.equal(status.ok, false);
        assert.equal(context.state.messages.length, 3);
    }
});

test("lists use compact stable buttons for long Unicode titles and distinct authors", async () => {
    // Motivation: Telegram limits callback data by byte length, so list
    // rendering must keep Unicode titles compact and distinguish authors.

    // 1. create a dialog and a catalog with ambiguous and long titles
    let context;
    let scores;
    let dialog;
    {
        context = fixture();
        const long_score = new Score(
            "Длинное название 🎵".repeat(100), "Автор".repeat(100), "", 60,
            "https://example.org/long.pdf");
        scores = [...context.state.catalog, long_score];
        dialog = new ChoristerDialog(context.user, {}, journal);
    }

    // 2. render the scores list and collect its buttons
    let buttons;
    {
        assert.equal((await dialog.send_scores_list(scores)).ok, true);
        buttons = context.state.messages[0].options.reply_markup.inline_keyboard.flat();
    }

    // 3. verify that every score has a button and authors remain distinct
    {
        assert.equal(buttons.length, 3);
        assert.notEqual(buttons[0].callback_data, buttons[1].callback_data);
    }

    // 4. verify each button's compact identity
    for (const [index, score] of scores.entries()) {
        // 4.1 read the callback payload produced by the dialog
        let data;
        {
            data = buttons[index].callback_data;
        }

        // 4.2 verify stable identity within Telegram's payload limit
        {
            assert.ok(Buffer.byteLength(data, "utf8") <= 64);
            assert.equal(data, ScoreDownloads.create_button(score).callback_data);
            assert.doesNotMatch(data, /https:\/\//);
        }
    }
});

test("buttons keep working after an hour and on repeated clicks", async () => {
    // Motivation: callback cleanup previously broke visible score buttons
    // after an hour; repeated Telegram requests must also remain reusable.

    // 1. create a user, download button, and time beyond the former lifetime
    let context;
    let data;
    let later;
    {
        context = fixture();
        data = ScoreDownloads.create_button(context.state.catalog[0]).callback_data;
        later = new Date(Date.now() + 3601_000);
    }

    // 2. click the same button twice after an hour
    {
        await click(context, data, later);
        await click(context, data, later);
    }

    // 3. verify two deliveries, acknowledgements, and fresh access checks
    {
        assert.equal(context.state.messages.length, 2);
        assert.equal(context.state.answers.length, 2);
        assert.ok(context.state.access_checks.length >= 2);
    }

    // 4. verify that each delivery contains the correct link and destination
    for (const message of context.state.messages) {
        assert.equal(message.file, "https://example.org/score.pdf");
        assert.equal(message.chat_id, 123);
    }
});

test("buttons survive recreation of the user, environment, and catalog in a different order", async () => {
    // Motivation: Telegram retains message buttons across bot restarts;
    // routing must rely on score identity rather than process or row order.

    // 1. create the original user's environment
    let previous;
    {
        previous = fixture();
    }

    // 2. render a list and retain the selected button's payload
    let data;
    {
        const dialog = new ChoristerDialog(previous.user, {}, journal);
        await dialog.send_scores_list(previous.state.catalog);
        data = previous.state.messages[0].options.reply_markup.inline_keyboard[0][0].callback_data;
    }

    // 3. recreate the user and environment with a reordered catalog
    let restarted;
    {
        restarted = fixture();
        restarted.state.catalog.reverse();
    }

    // 4. click the payload retained from the original list
    {
        await click(restarted, data);
    }

    // 5. verify that identity resolves to the original author's score
    {
        assert.equal(restarted.state.messages[0].file, "https://example.org/score.pdf");
    }
});
