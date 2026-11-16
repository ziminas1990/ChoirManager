import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, mock, test } from "node:test";

import { Bot } from "node-telegram-bot-api";

import { GroupChat } from "@src/adapters/telegram/group_chat.js";
import { DepositOwnerDialog } from "@src/adapters/telegram/dialogs/deposit_owner_dialog.js";
import { ManagersGroup } from "@src/adapters/telegram/dialogs/managers_group.js";
import { FeedbackWidget } from "@src/adapters/telegram/widgets/feedback_activity.js";
import { TelegramUser } from "@src/adapters/telegram/telegram_user.js";
import { MemoryJournal } from "@src/components/memory_journal.js";
import { Deposit } from "@src/entities/deposit.js";
import { create_task_update, TaskData } from "@src/entities/task.js";
import { Language } from "@src/entities/user.js";
import { IUserAgent } from "@src/interfaces/user_agent.js";
import { TaskTrackerEvent } from "@src/interfaces/task_tracker_service.js";
import { CoreAPI } from "@src/use_cases/core.js";
import { current_month, escape_html, Formatter, GlobalFormatter } from "@src/utils.js";
import { render_button_grid, with_button_grid } from "@src/adapters/telegram/button_grid.js";
import { Expected } from "@src/utils/expected.js";
import { render_confirmation, render_result } from "@src/utils/string_engine/administration.js";
import { render_task_tracker_event } from "@src/utils/string_engine/task_tracker.js";

import { telegram_config } from "@tests/helpers/config.js";
import { user_profile } from "@tests/helpers/user.js";
import { embedded_grid, telegram_message } from "@tests/mocks/telegram.js";
import { mock_user_replica } from "@tests/mocks/user_replica.js";

mock.method(CoreAPI, "on_new_user_agent", () => Expected.ok(undefined));
GlobalFormatter.init("html");
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
        html = '<table>\n<tr><td>Piece</td><td>50%</td></tr>\n</table>'
            + '<pre><code>first line\n  second line</code></pre>'
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
        assert.deepEqual(JSON.parse(String(fields.get("reply_markup"))), { remove_keyboard: true });
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
    // contract while preserving destinations and removing old navigation.

    // 1. create a sender and escaped content
    let context;
    let html;
    {
        context = fixture();
        html = `<b>Report</b><br>${escape_html('A & B <C> "D"')}`;
    }

    // 2. send privately and to the group topic
    {
        assert.equal((await context.user.send_message(html)).ok, true);
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
        assert.deepEqual(JSON.parse(String(preview.fields.get("reply_markup"))), { remove_keyboard: true });
        assert.equal(publication.fields.get("chat_id"), "-100");
        assert.equal(publication.fields.get("message_thread_id"), "12");
    }
});

for (const lang of [Language.RU, Language.EN]) {
    test(`transaction history sends a localized Rich HTML table in ${lang}`, async () => {
        // Motivation: the real SDK request must preserve the table columns,
        // transaction values and localized comments without a currency.

        // 1. prepare a localized dialog and two different transaction types
        let context;
        let dialog;
        let month;
        {
            context = fixture();
            context.user.set_user_info({ ...context.user.info(), lang });
            dialog = new DepositOwnerDialog(context.user, new MemoryJournal(),
                undefined, new Formatter("html"));
            month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        }

        // 2. send the history through the real dialog and SDK
        {
            const status = await dialog.send_transactions_info([
                { date: month, tgid: "member", type: "balance", before: 0, after: 140 },
                { date: month, tgid: "member", type: "membership", before: 140,
                    after: 90, membership_month: month },
            ]);
            assert.equal(status.ok, true);
        }

        // 3. verify the table and both transaction rows in the wire payload
        {
            const html = JSON.parse(String(context.calls[0].fields.get("rich_message"))).html;
            const header = lang === Language.RU
                ? "Транзакции за последние 6 месяцев:" : "Transactions for the last 6 months:";
            const date = /<tr><td>(01 [A-ZА-Я]{3})<\/td>/.exec(html)?.[1];
            assert.ok(date);
            const credit = lang === Language.RU ? "Пополнение" : "Top-up";
            const debit = lang === Language.RU ? "Списание" : "Withdrawal";
            const balance = lang === Language.RU ? "пополнение депозита" : "Deposit top-up";
            const membership = lang === Language.RU ? "оплата членского взноса" : "Membership fee payment";
            assert.ok(html.startsWith(`<h3>${header}</h3><table bordered striped compact>`));
            assert.ok(html.includes(`<tr><td>${date}</td><td>${credit} 140</td>`
                + `<td align="right">0 -&gt; 140</td><td>${balance}</td></tr>`));
            assert.ok(html.includes(`<tr><td>${date}</td><td>${debit} 50</td>`
                + `<td align="right">140 -&gt; 90</td><td>${membership}</td></tr>`));
            assert.equal((html.match(/<tr>/g) ?? []).length, 3);
            assert.doesNotMatch(html, /GEL|₾/);
        }
    });
}

test("deposit information, reminders and changes preserve lines and blank lines", async () => {
    // Motivation: nested deposit templates must retain their spacing when
    // embedded with payment details and Rich HTML callback controls.

    // 1. prepare a deposit dialog with payment details and an unpaid month
    let context;
    let dialog;
    let deposit;
    {
        context = fixture();
        dialog = new DepositOwnerDialog(context.user, new MemoryJournal(), {
            membership_fee: 140,
            accounts: [{ title: "Bank", account: "GE123", receiver: "Singer" }],
        }, new Formatter("html"));
        deposit = new Deposit("member", "Member", 90, new Map());
    }

    // 2. send the deposit summary, reminder and change notification
    {
        assert.equal((await dialog.send_deposit_info(deposit)).ok, true);
        assert.equal((await dialog.send_membership_reminder(50)).ok, true);
        assert.equal((await dialog.send_deposit_changes(deposit, {
            total_change: 90, balance: [0, 90], membership: [[current_month(), 0, 20]],
        })).ok, true);
    }

    // 3. check nested line breaks, formatting and embedded controls on the wire
    {
        const [summary, reminder, change] = context.calls.map(call =>
            JSON.parse(String(call.fields.get("rich_message"))).html as string);
        assert.ok(summary.startsWith("Your deposit:<br><br>Funds on deposit: 90 GEL<br>Paid for"));
        assert.match(summary, /<br><br>You are expected to pay another 50 GEL/);
        assert.match(summary, /<b>Bank<\/b>:<br>Account: <code>GE123<\/code><br>Receiver: <code>Singer<\/code>/);
        assert.equal(embedded_grid(summary)[0][0].text, "Transactions");
        assert.match(reminder, /fee\.<br><br>The membership fee can be transferred/);
        assert.equal(embedded_grid(reminder)[0][0].text, "I have paid already 🤷");
        assert.ok(change.startsWith("<b>Deposit changes: credited 90 GEL</b><br><br>Funds on deposit:"));
        assert.match(change, /\(credited 90 GEL\)<br>Membership for/);
        assert.match(change, /\(credited 20 GEL\)<br><br>You are expected/);
    }
});

test("feedback edits and group publications preserve literal multiline text", async () => {
    // Motivation: typed feedback must retain its lines in the editable preview
    // and the managers' copy without interpreting literal HTML as markup.

    // 1. prepare feedback with mixed newline conventions and literal markup
    let context;
    let widget;
    let managers;
    let details;
    {
        context = fixture();
        details = 'First & <b>literal</b>\r\n\r\nSecond\rThird\nLast';
        widget = new FeedbackWidget(context.user, new MemoryJournal());
        widget.on_details_provided(details);
        managers = new ManagersGroup(context.group, new MemoryJournal());
    }

    // 2. render the editable preview and publish the same feedback to the group
    {
        assert.equal((await widget.start()).ok, true);
        assert.equal((await managers.on_new_feedback({ date: new Date(), details })).ok, true);
    }

    // 3. check both destinations retain explicit breaks and escaped literals
    {
        const preview = context.calls.find(call => call.method === "editMessageText")!;
        const publication = context.calls.at(-1)!;
        for (const call of [preview, publication]) {
            const html = JSON.parse(String(call.fields.get("rich_message"))).html;
            assert.ok(html.includes('<blockquote>First &amp; &lt;b&gt;literal&lt;/b&gt;'
                + '<br><br>Second<br>Third<br>Last</blockquote>'));
        }
        assert.equal(publication.fields.get("chat_id"), "-100");
        assert.equal(publication.fields.get("message_thread_id"), "12");
    }
});

test("table record notifications retain field boundaries and multiline answers", async () => {
    // Motivation: a form notification must separate fields and preserve blank
    // lines inside an answer after being sent as Rich HTML to managers.

    // 1. prepare a managers chat and a form response with a multiline answer
    let context;
    let managers;
    {
        context = fixture();
        managers = new ManagersGroup(context.group, new MemoryJournal());
    }

    // 2. send a record containing two fields
    {
        assert.equal((await managers.on_new_table_record({ table_name: "Form", fields: [
            { name: "Answer", value: "First\n\nSecond & <third>" },
            { name: "Empty", value: "" },
        ] })).ok, true);
    }

    // 3. inspect explicit field separators and escaped answer content
    {
        const html = JSON.parse(String(context.calls[0].fields.get("rich_message"))).html;
        assert.equal(html, 'Новая запись в таблице "Form":<br><br>'
            + '<b>Answer</b><br>First<br><br>Second &amp; &lt;third&gt;<br><br>'
            + '<b>Empty</b><br>(нет ответа)<br>');
    }
});

test("task event publications separate fields and preserve multiline comments", async () => {
    // Motivation: automatic task events bypass the AI formatter and must
    // already contain visible breaks before reaching the group transport.

    // 1. prepare all task event types, including a multiline comment update
    let context;
    let now;
    let events: TaskTrackerEvent[];
    {
        context = fixture();
        now = new Date(2026, 0, 1);
        const task: TaskData = { id: "task", schema: 1, created_at: now,
            author: "Member", title: "Prepare & sing", status: "pending",
            comment: "First\n\nSecond <line>", deadline: new Date(2026, 0, 5) };
        events = [
            { what: "new_task", task },
            { what: "task_updated", update: [create_task_update(task, {
                ...task, comment: "Updated\r\nComment <line>",
            })] },
            { what: "task_deleted", task },
            { what: "deadline_notification", tasks: [task] },
        ];
    }

    // 2. publish every event using the same renderer as the managers' agent
    for (const event of events) {
        const html = render_task_tracker_event(event, now);
        assert.equal((await context.group.send_message(html)).ok, true);
    }

    // 3. verify each event's field boundaries and both comment variants
    {
        const messages = context.calls.map(call =>
            JSON.parse(String(call.fields.get("rich_message"))).html as string);
        for (const html of messages) {
            assert.match(html, /<br><br><b>/);
            assert.ok(html.includes("Prepare &amp; sing"));
            assert.doesNotMatch(html, /[\r\n]/);
        }
        assert.ok(messages[0].includes("<b>Комментарий:</b><br>First<br><br>Second &lt;line&gt;"));
        assert.ok(messages[1].includes("<b>Комментарий:</b><br>Updated<br>Comment &lt;line&gt;"));
    }
});

test("administration confirmations and outcomes retain separate profile fields", async () => {
    // Motivation: administration renders its own HTML, so fixing dialog
    // wrappers alone cannot restore profile spacing in these messages.

    // 1. prepare a user profile and Telegram sender
    let context;
    let profile;
    {
        context = fixture();
        profile = user_profile("new_member");
    }

    // 2. send a confirmation inside an admin notification and its outcome
    {
        const confirmation = render_confirmation({ what: "create_user", user: profile });
        assert.equal((await context.user.as_admin().send_notification(confirmation)).ok, true);
        const outcome = render_result({ what: "user_created", user: profile });
        assert.equal((await context.user.send_message(outcome)).ok, true);
    }

    // 3. check header spacing and explicit separators between profile fields
    {
        const messages = context.calls.map(call =>
            JSON.parse(String(call.fields.get("rich_message"))).html as string);
        assert.ok(messages[0].startsWith("<b>Admin's notification:</b><br><br>Подтвердите"));
        assert.ok(messages[1].startsWith("Пользователь создан:<br><br><b>ID:</b> new_member<br>"));
        for (const html of messages) {
            assert.ok(html.includes("<br><b>Язык:</b> en<br><b>Голос:</b> alto<br><b>Роли:</b>"));
        }
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
