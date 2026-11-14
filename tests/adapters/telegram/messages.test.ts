import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, mock, test } from "node:test";

import { Bot } from "node-telegram-bot-api";

import { GroupChat } from "@src/adapters/telegram/group_chat.js";
import { TelegramUser } from "@src/adapters/telegram/telegram_user.js";
import { MemoryJournal } from "@src/components/memory_journal.js";
import { IUserAgent } from "@src/interfaces/user_agent.js";
import { CoreAPI } from "@src/use_cases/core.js";
import { escape_html } from "@src/utils.js";
import { render_button_grid, with_button_grid } from "@src/adapters/telegram/button_grid.js";
import { Expected } from "@src/utils/expected.js";

import { telegram_config } from "@tests/helpers/config.js";
import { user_profile } from "@tests/helpers/user.js";
import { embedded_grid, telegram_message } from "@tests/mocks/telegram.js";
import { mock_user_replica } from "@tests/mocks/user_replica.js";

mock.method(CoreAPI, "on_new_user_agent", () => Expected.ok(undefined));
after(() => mock.restoreAll());

function fixture() {
    const calls: { method: string; fields: FormData }[] = [];
    const state = { reject: false, network_error: false };
    const bot = new Bot("test-only-token", {
        maxRetries: 0,
        fetch: async (input, options) => {
            const request = new Request(input, options);
            calls.push({ method: new URL(request.url).pathname.split("/").at(-1)!,
                fields: await request.formData() });
            if (state.network_error) {
                throw new Error("Network unavailable");
            }
            return new Response(JSON.stringify(state.reject
                ? { ok: false, error_code: 400, description: "Bad Request: unsupported markup" }
                : { ok: true, result: telegram_message({ message_id: calls.length }) }), {
                status: state.reject ? 400 : 200,
                headers: { "content-type": "application/json" },
            });
        },
    });
    const journal = new MemoryJournal();
    const user = new TelegramUser(user_profile("member"), 123, telegram_config(),
        { users: mock_user_replica() }, journal);
    assert.equal(user.init(bot).ok, true);
    const group = new GroupChat(-100, 12, bot, journal);
    return { user, group, calls, state };
}

test("Rich HTML is serialized through the SDK for sending and editing", async () => {
    // Motivation: mocking SDK methods cannot detect incorrectly named wire
    // parameters or accidentally sending rich content through ordinary HTML.

    // 1. prepare a rich message containing a table and an embedded callback
    let context;
    let html;
    {
        context = fixture();
        html = '<table><tr><td>Piece</td><td>50%</td></tr></table>'
            + '<p><tg-button type="callback_data" data="stats:v1:60">60 days</tg-button></p>';
    }

    // 2. send through the real SDK and verify the nested HTML payload
    let message_id;
    {
        const agent: IUserAgent = context.user;
        const sent = await agent.send_message(html);
        assert.equal(sent.ok, true, sent.ok ? undefined : sent.error);
        assert.equal(sent.value, 1);
        message_id = sent.value;
        const { method, fields } = context.calls[0];
        assert.equal(method, "sendRichMessage");
        assert.equal(fields.get("chat_id"), "123");
        assert.deepEqual(JSON.parse(String(fields.get("rich_message"))), { html });
        assert.equal(fields.has("text"), false);
        assert.equal(fields.has("parse_mode"), false);
        assert.equal(fields.has("reply_markup"), false);
    }

    // 3. update that message and clear any previous external keyboard
    {
        assert.equal((await context.user.edit_message(
            message_id, { text: html })).ok, true);
        const { method, fields } = context.calls[1];
        assert.equal(method, "editMessageText");
        assert.equal(fields.get("chat_id"), "123");
        assert.equal(fields.get("message_id"), String(message_id));
        assert.deepEqual(JSON.parse(String(fields.get("rich_message"))), { html });
        assert.deepEqual(JSON.parse(String(fields.get("reply_markup"))), { inline_keyboard: [] });
        assert.equal(fields.has("text"), false);
        assert.equal(fields.has("parse_mode"), false);
    }
});

test("private and group messages use Rich HTML with identical content", async () => {
    // Motivation: previews and publications must use the same rendering
    // contract while preserving destinations and reply navigation.

    // 1. create a sender and escaped content
    let context;
    let html;
    let keyboard;
    {
        context = fixture();
        html = `<b>Report</b>\n${escape_html('A & B <C> "D"')}`;
        keyboard = { keyboard: [[{ text: "Statistics" }]], is_persistent: true, resize_keyboard: true };
    }

    // 2. send privately and to the group topic
    {
        assert.equal((await context.user.send_message(html, { reply_markup: keyboard })).ok, true);
        assert.equal((await context.group.send_message(html)).ok, true);
    }

    // 3. inspect the actual SDK wire payloads
    {
        const [preview, publication] = context.calls;
        for (const call of context.calls) {
            assert.equal(call.method, "sendRichMessage");
            assert.deepEqual(JSON.parse(String(call.fields.get("rich_message"))), { html });
            assert.equal(call.fields.has("parse_mode"), false);
            assert.equal(call.fields.has("text"), false);
        }
        assert.equal(preview.fields.get("chat_id"), "123");
        assert.deepEqual(JSON.parse(String(preview.fields.get("reply_markup"))), keyboard);
        assert.equal(publication.fields.get("chat_id"), "-100");
        assert.equal(publication.fields.get("message_thread_id"), "12");
    }
});

for (const failure of ["uninitialized", "network"]) {
    test(`Rich HTML sends handle ${failure} failures`, async () => {
        // Motivation: delivery failures must remain handled errors under the
        // public sender contract, including calls without options.

        // 1. create an agent that cannot deliver
        let agent: IUserAgent;
        {
            if (failure === "uninitialized") {
                agent = new TelegramUser(user_profile("member"), 123, telegram_config(),
                    { users: mock_user_replica() }, new MemoryJournal());
            } else {
                const context = fixture();
                context.state.network_error = true;
                agent = context.user;
            }
        }

        // 2. check the handled result
        {
            const sent = await agent.send_message("<b>Hello</b>");
            assert.equal(sent.ok, false);
            assert.match(sent.error, failure === "uninitialized"
                ? /API is not initialized/ : /Network request failed/);
        }
    });
}

for (const operation of ["rich send", "rich edit", "private HTML", "group HTML"]) {
    test(`Telegram markup errors return failure for ${operation}`, async () => {
        // Motivation: an API rejection must reach the caller as an error so
        // report delivery and statistics never claim a message was displayed.

        // 1. configure an actual Telegram error envelope at the HTTP boundary
        let context;
        {
            context = fixture();
            context.state.reject = true;
        }

        // 2. perform the operation and inspect the handled failure
        {
            const result = operation === "rich send"
                ? await context.user.send_message("<unsupported>value</unsupported>")
                : operation === "rich edit"
                    ? await context.user.edit_message(42, { text: "<unsupported>value</unsupported>" })
                    : operation === "private HTML"
                        ? await context.user.send_message("<unsupported>value</unsupported>")
                        : await context.group.send_message("<unsupported>value</unsupported>");
            assert.equal(result.ok, false);
            assert.match(result.error, /unsupported markup/);
            assert.equal(context.calls.length, 1);
        }
    });
}

test("local document uploads retain bytes, metadata and the destination topic", async t => {
    // Motivation: SDK v2 treats a string as a remote file identifier; local
    // paths must become multipart uploads instead of silently changing meaning.

    // 1. create a local file and a transport capture
    let context;
    let filename;
    {
        context = fixture();
        const directory = mkdtempSync(join(tmpdir(), "choir-upload-"));
        t.after(() => rmSync(directory, { recursive: true, force: true }));
        filename = join(directory, "report.txt");
        writeFileSync(filename, "Report bytes: A & B");
    }

    // 2. upload privately and to a group topic using the same local file
    {
        assert.equal((await context.user.send_file(filename, "Private report", "text/plain")).ok, true);
        assert.equal((await context.group.send_file(filename, "Group report", "text/plain")).ok, true);
    }

    // 3. verify multipart file bytes and metadata in both destinations
    for (const [index, { method, fields }] of context.calls.entries()) {
        assert.equal(method, "sendDocument");
        const file = fields.get("document");
        assert.ok(file instanceof Blob);
        assert.equal(file.type, "text/plain");
        assert.equal(await file.text(), "Report bytes: A & B");
        assert.equal(fields.get("chat_id"), index === 0 ? "123" : "-100");
        assert.equal(fields.get("caption"), index === 0 ? "Private report" : "Group report");
        assert.equal(fields.get("message_thread_id"), index === 0 ? null : "12");
    }
});


test("edits replace embedded controls and clear legacy inline keyboards", async () => {
    // Motivation: refreshing old messages must remove separate controls, and
    // subsequent edits must replace the entire embedded grid with the body.

    // 1. prepare an agent and a message containing controls
    let context;
    let html;
    {
        context = fixture();
        html = with_button_grid("Changed", [[{ text: "OK", callback_data: "ok" }]]);
    }

    // 2. replace controls together with content and then remove them
    for (const text of [html, "Completed"]) {
        assert.equal((await context.user.edit_message(42, { text })).ok, true);
        const fields: FormData = context.calls.at(-1)!.fields;
        assert.deepEqual(JSON.parse(String(fields.get("rich_message"))), { html: text });
        assert.deepEqual(JSON.parse(String(fields.get("reply_markup"))), { inline_keyboard: [] });
    }

    // 3. ensure edit failures are returned to the caller
    {
        context.state.reject = true;
        assert.equal((await context.user.edit_message(42, { text: "Rejected" })).ok, false);
        context.state.reject = false;
        context.state.network_error = true;
        assert.equal((await context.user.edit_message(42, { text: "Completed" })).ok, false);
    }
});

test("button grids preserve rows and literal callback and URL labels", () => {
    // Motivation: dynamic grids have partial last rows, and metacharacters
    // in literal labels or actions must never become markup.

    // 1. render mixed actions with an incomplete final row
    let html;
    let grid;
    {
        grid = [
            [{ text: 'A < B & "C"', callback_data: 'value<&">' },
                { text: "Join & sing", url: 'https://example.org/?a=1&b="2"' }],
            [{ text: "Last", callback_data: "last" }],
        ];
        html = with_button_grid("<b>Body</b>", grid);
    }

    // 2. verify exact row boundaries, escaped literals and body placement
    {
        assert.deepEqual(embedded_grid(html), grid);
        assert.ok(html.startsWith("<b>Body</b>\n<tg-button-row>"));
        assert.doesNotMatch(html, /<table|style="primary"/);
        assert.match(html, /A &lt; B &amp; &quot;C&quot;/);
        assert.match(html, /data="value&lt;&amp;&quot;&gt;"/);
        assert.match(html, /type="url" url="https:\/\/example.org\/\?a=1&amp;b=&quot;2&quot;"/);
        assert.equal(render_button_grid([]), "");
        assert.equal(with_button_grid("Body", []), "Body");
    }
});
