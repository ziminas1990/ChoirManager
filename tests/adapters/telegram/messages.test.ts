import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, mock, test } from "node:test";

import { Bot } from "node-telegram-bot-api";

import { GroupChat } from "@src/adapters/telegram/group_chat.js";
import { TelegramUser } from "@src/adapters/telegram/telegram_user.js";
import { MemoryJournal } from "@src/components/memory_journal.js";
import { CoreAPI } from "@src/use_cases/core.js";
import { escape_html } from "@src/utils.js";
import { Expected } from "@src/utils/expected.js";

import { telegram_config } from "@tests/helpers/config.js";
import { user_profile } from "@tests/helpers/user.js";
import { telegram_message } from "@tests/mocks/telegram.js";
import { mock_user_replica } from "@tests/mocks/user_replica.js";

mock.method(CoreAPI, "on_new_user_agent", () => Expected.ok(undefined));
after(() => mock.restoreAll());

function fixture() {
    const calls: { method: string; fields: FormData }[] = [];
    const state = { reject: false };
    const bot = new Bot("test-only-token", {
        maxRetries: 0,
        fetch: async (input, options) => {
            const request = new Request(input, options);
            calls.push({ method: new URL(request.url).pathname.split("/").at(-1)!,
                fields: await request.formData() });
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
        const sent = await context.user.send_rich_message(html);
        assert.equal(sent.ok, true, sent.ok ? undefined : sent.error);
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
        assert.equal((await context.user.edit_rich_message(message_id, html)).ok, true);
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

test("ordinary HTML content is identical in private previews and group topics", async () => {
    // Motivation: upgrading the SDK must preserve HTML, existing keyboards,
    // and destination topics for callers sharing preview and published content.

    // 1. prepare formatted content with literal user-provided metacharacters
    let context;
    let html;
    let keyboard;
    {
        context = fixture();
        html = `<b>Report</b>\n${escape_html('A & B <C> "D"')}`;
        keyboard = { inline_keyboard: [[{ text: "Confirm", callback_data: "confirm:1" }]] };
    }

    // 2. send a private preview and publish the same content to a group topic
    {
        assert.equal((await context.user.send_message(html, { reply_markup: keyboard })).ok, true);
        assert.equal((await context.group.send_message(html)).ok, true);
    }

    // 3. verify HTML mode and the exact destinations and content on the wire
    {
        const [preview, publication] = context.calls;
        assert.equal(preview.method, "sendMessage");
        assert.equal(publication.method, "sendMessage");
        assert.equal(preview.fields.get("parse_mode"), "HTML");
        assert.equal(publication.fields.get("parse_mode"), "HTML");
        assert.equal(preview.fields.get("text"), html);
        assert.equal(publication.fields.get("text"), html);
        assert.equal(preview.fields.get("chat_id"), "123");
        assert.deepEqual(JSON.parse(String(preview.fields.get("reply_markup"))), keyboard);
        assert.equal(publication.fields.get("chat_id"), "-100");
        assert.equal(publication.fields.get("message_thread_id"), "12");
    }
});

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
                ? await context.user.send_rich_message("<unsupported>value</unsupported>")
                : operation === "rich edit"
                    ? await context.user.edit_rich_message(42, "<unsupported>value</unsupported>")
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
