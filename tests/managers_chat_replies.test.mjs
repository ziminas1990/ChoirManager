import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import TelegramBot from "node-telegram-bot-api";
import { Timestamp } from "@google-cloud/firestore";

import { GoogleAuth } from "../dist/api/google_auth.js";
import { OpenaiAPI } from "../dist/api/openai.js";
import { GoogleFirestore } from "../dist/adapters/messages_storage/google_firestore.js";
import { MessagesStorageFactory } from "../dist/adapters/messages_storage/factory.js";
import { PlainCollectionFactory } from "../dist/adapters/plain_collection/factory.js";
import { TgAdapter } from "../dist/adapters/telegram/adapter.js";
import { ManagersAgent } from "../dist/components/ai/agents/managers_agent.js";
import { Runtime } from "../dist/runtime.js";
import { Expected } from "../dist/utils/expected.js";
import { TokenBucket } from "../dist/utils/token_bucket.js";

afterEach(() => mock.restoreAll());

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const journal = { child() { return this; }, log() { return logger; } };
const sender = { id: 123, first_name: "Reply", last_name: "Author" };
const original_author = { id: 456, first_name: "Original", last_name: "Author",
    username: "original_author" };
const managers_chat_id = -100;

function telegram_message(message_id, text, extra = {}) {
    return { message_id, text, from: sender, date: Math.floor(Date.now() / 1000) - 60,
        chat: { id: managers_chat_id, type: "supergroup", title: "Managers" }, ...extra };
}

function firestore_fixture() {
    const records = new Map();
    const updates = [];
    const queries = [];
    const id_queries = [];
    let read_error;
    let write_error;
    let write_hook;
    function snapshot(record) {
        return { exists: record !== undefined,
            data: () => record === undefined ? undefined : {
                ...structuredClone(record), time: Timestamp.fromDate(record.time),
            } };
    }
    function query(filters = []) {
        return {
            where(field, operator, value) { return query([...filters, { field, operator, value }]); },
            orderBy() { return this; },
            async get() {
                queries.push(filters);
                const selected = [...records.values()].filter(record => filters.every(filter =>
                    filter.operator === ">=" ? record[filter.field] >= filter.value
                        : record[filter.field] <= filter.value));
                return { forEach(visit) {
                    for (const record of selected) {
                        visit(snapshot(record));
                    }
                } };
            },
        };
    }
    const collection = {
        ...query(),
        doc(id) {
            return {
                id,
                async create(data) {
                    if (write_hook) {
                        await write_hook(data);
                    }
                    if (write_error) {
                        throw write_error;
                    }
                    assert.equal(records.has(id), false, "duplicate document");
                    assert_no_undefined(data);
                    records.set(id, structuredClone(data));
                },
                async update(patch) {
                    if (write_error) {
                        throw write_error;
                    }
                    assert.equal(records.has(id), true, "missing document");
                    updates.push(structuredClone(patch));
                    records.set(id, { ...records.get(id), ...structuredClone(patch) });
                },
            };
        },
    };
    mock.method(GoogleAuth, "get_firestore", () => ({
        collection: () => collection,
        async getAll(...refs) {
            const ids = refs.map(ref => records.get(ref.id)?.message_id ?? ref.id);
            id_queries.push(ids);
            const error = typeof read_error === "function" ? read_error(ids) : read_error;
            if (error) {
                throw error;
            }
            return refs.map(ref => snapshot(records.get(ref.id)));
        },
    }));
    mock.method(TokenBucket.prototype, "wait_tokens", async () => {});
    return { records, updates, queries, id_queries,
        fail_id_reads: error => { read_error = error; },
        fail_writes: error => { write_error = error; },
        block_writes: hook => { write_hook = hook; },
        create_backlog: () => new GoogleFirestore({ database_id: "test", collection_name: "managers" }, false),
        stored: id => [...records.values()].find(record => record.message_id === String(id)) };
}

function assert_no_undefined(value) {
    if (value && typeof value === "object") {
        for (const item of Object.values(value)) {
            assert.notEqual(item, undefined, "Firestore rejects undefined fields");
            assert_no_undefined(item);
        }
    }
}

async function fixture(t, respond) {
    const firestore = firestore_fixture();
    function create_cached_backlog() {
        const result = MessagesStorageFactory.create({ type: "local_cache", window_days: 5,
            underlying: { type: "firestore", database_id: "test", collection_name: "managers",
                read_only: false } }, journal);
        assert.equal(result.ok, true);
        return result.value;
    }
    let backlog = create_cached_backlog();
    const requests = [];
    mock.method(OpenaiAPI, "get_llm", () => ({
        async generate_response(context, options) {
            requests.push(structuredClone(context));
            if (respond) {
                return respond(context, options, requests.length);
            }
            const content = JSON.stringify({ status: "done" });
            return Expected.ok({ messages: [{ role: "assistant", content }], content });
        },
    }));
    function create_agent() {
        return new ManagersAgent({ prompt_file: "config/managers_chat_agent_prompt.txt",
            context_days: 3, model: "test" }, backlog,
        { subscribe: () => ({ poll: async () => Expected.ok(undefined) }) },
        { bot_id: "test_bot", get_managers_chat: async () => ({
            send_typing_action: async () => Expected.ok(undefined),
            send_message: async () => Expected.ok("1000"),
        }) }, undefined, undefined,
        { resolve_user: ({ system_id }) => Expected.ok(system_id === "original-author"
            ? { name: "Original", surname: "Author" } : undefined) }, journal);
    }
    let agent = create_agent();
    assert.equal((await agent.init()).ok, true);
    mock.method(Runtime, "get_instance", () => ({
        get_managers_backlog: () => backlog, get_managers_agent: () => agent,
    }));
    mock.method(PlainCollectionFactory, "create", () => Expected.ok({
        get_all: async () => Expected.ok([]), proceed: async () => Expected.ok([]),
    }));
    mock.method(TelegramBot.prototype, "startPolling", async () => {});
    const directory = mkdtempSync(join(tmpdir(), "managers-replies-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const token_file = join(directory, "token");
    writeFileSync(token_file, "test-only-token");
    const adapter = TgAdapter.unpack({ token_file, users_storage: {} }, {}, {},
        { managers_chat_id }, journal);
    mock.method(adapter, "get_user", () => Expected.ok({ userid: () => "reply-author" }));
    mock.method(adapter, "resolve_group_user_info", async () => Expected.ok({ roles: [] }));
    assert.equal((await adapter.init()).ok, true);
    let tick = Date.now();
    return {
        ...firestore, requests,
        get backlog() { return backlog; },
        emit: (event, message) => adapter.bot.emit(event, message),
        async proceed(expected_ok = true) {
            const now = new Date(tick += 1001);
            assert.equal((await adapter.proceed(now)).ok, true);
            const status = await agent.proceed();
            assert.equal(status.ok, expected_ok, status.ok ? undefined : status.error);
            return status;
        },
        async restart() {
            backlog = create_cached_backlog();
            agent = create_agent();
            assert.equal((await agent.init()).ok, true);
        },
    };
}

function context_message(request, id) {
    const message = request.find(message => typeof message.content === "string"
        && message.content.startsWith(`id: ${id}\n`));
    assert.ok(message, `message ${id} must reach the LLM`);
    return message.content;
}

function reply_reference(content) {
    const header = content.split("\ntext:\n")[0];
    const line = header.split("\n").find(line => line.startsWith("reply_to: "));
    return line === undefined ? undefined : line.slice("reply_to: ".length);
}

function context_ids(request) {
    return request.filter(message => message.content?.startsWith("id: "))
        .map(message => message.content.split("\n")[0].slice(4));
}

test("Telegram replies load full chains only before an LLM response, including after restart", async t => {
    // Motivation: unmentioned messages and startup must not read history, while
    // each response must receive all available ancestors from current storage.

    // 1. create the real adapter, chat, storage adapter, and managers agent
    let context;
    let original;
    let reply;
    let chain;
    {
        context = await fixture(t);
        original = telegram_message(10, "@test_bot Proposal\ntext:\nMeet on Sunday?", {
            date: Math.floor(Date.now() / 1000) - 10 * 86400, from: original_author,
        });
        const backlog = context.create_backlog();
        assert.equal((await backlog.add_message({
            time: new Date(original.date * 1000), message_id: "10",
            sender_id: "original-author", text: original.text, reply_to: "5",
        })).ok, true);
        assert.equal((await backlog.add_message({
            time: new Date((original.date - 86400) * 1000), message_id: "5",
            sender_id: "original-author", text: "Earlier ancestor", reply_to: null,
        })).ok, true);
        reply = telegram_message(20, "Yes, I agree", { reply_to_message: original });
        chain = telegram_message(30, "@test_bot Summarize", { reply_to_message: reply });
    }

    // 2. collect an unmentioned reply without triggering the bot
    {
        context.emit("message", reply);
        await context.proceed();
        assert.equal(context.requests.length, 0);
        assert.equal(context.stored(20).reply_to, "10");
        assert.deepEqual(context.id_queries, []);
        assert.deepEqual(context.queries, []);
    }

    // 3. trigger a response with a reply to that reply, preserving direct links
    let live_reply;
    let live_chain;
    {
        context.emit("message", chain);
        await context.proceed();
        assert.equal(context.requests.length, 1);
        live_reply = context_message(context.requests[0], 20);
        live_chain = context_message(context.requests[0], 30);
        assert.equal(reply_reference(live_reply), "10");
        assert.equal(reply_reference(live_chain), "20");
        assert.equal(live_reply.includes(original.text), false);
        assert.equal(context.stored(30).reply_to, "20");
        const loaded_original = context_message(context.requests[0], 10);
        assert.ok(loaded_original.endsWith(`text:\n${original.text}`));
        assert.match(loaded_original, /name: Original Author\n/);
        assert.equal(reply_reference(loaded_original), "5");
        assert.deepEqual(context.id_queries, [["10"], ["5"]]);
        assert.equal(context.requests[0].filter(message => message.content?.startsWith("id: 20\n")).length, 1);
        assert.ok(context_message(context.requests[0], 5).endsWith("text:\nEarlier ancestor"));
        assert.deepEqual(context.requests[0].filter(message => message.content?.startsWith("id: "))
            .map(message => message.content.split("\n")[0]), ["id: 5", "id: 10", "id: 20", "id: 30"]);
    }

    // 4. reload through a fresh storage adapter and ask the restarted agent
    {
        await context.restart();
        assert.deepEqual(context.id_queries, [["10"], ["5"]]);
        assert.equal(context.requests.length, 1);
        context.emit("message", telegram_message(40, "@test_bot What did we agree on?"));
        await context.proceed();
        assert.equal(context.requests.length, 2);
        assert.deepEqual(context.id_queries, [["10"], ["5"], ["10"], ["5"]]);
        assert.equal(context_message(context.requests[1], 20), live_reply);
        assert.equal(context_message(context.requests[1], 30), live_chain);
        assert.equal(context_message(context.requests[1], 10), context_message(context.requests[0], 10));
        assert.equal(context_message(context.requests[1], 5), context_message(context.requests[0], 5));
        assert.equal(reply_reference(context_message(context.requests[1], 40)), undefined);
        const range = context.queries.at(-1);
        assert.ok(new Date(original.date * 1000) < range[0].value);
    }

    // 5. read the latest stored original after an edit without restarting
    {
        assert.equal((await context.backlog.update_message({
            time: new Date(original.date * 1000), message_id: "10",
            sender_id: "original-author", text: "Updated Sunday proposal",
        })).ok, true);
        context.emit("message", telegram_message(50, "@test_bot Summarize again"));
        await context.proceed();
        assert.ok(context_message(context.requests[2], 10).endsWith("text:\nUpdated Sunday proposal"));
    }

    // 6. stop loading originals after their referring messages expire
    {
        const later = Date.now() + 4 * 86400_000;
        mock.method(Date, "now", () => later);
        const query_count = context.id_queries.length;
        context.emit("message", telegram_message(60, "@test_bot A new topic"));
        await context.proceed();
        assert.equal(context.id_queries.length, query_count);
        assert.equal(context.requests[3].some(message => message.content?.startsWith("id: 10\n")), false);
        assert.equal(context.requests[3].some(message => message.content?.startsWith("id: 20\n")), false);
        assert.equal(context.requests[3].some(message => message.content?.startsWith("id: 5\n")), false);
    }
});

test("each managers response uses a fresh chat snapshot while retaining its tool round trip", async t => {
    // Motivation: rebuilding context must preserve tool execution within one
    // response and recover visible bot replies from storage on the next one.

    // 1. create an LLM that sends a visible reply through the real messenger tool
    let context;
    {
        context = await fixture(t, async (_messages, _options, request) => {
            if (request === 1) {
                return Expected.ok({ messages: [{ role: "tool_calls", calls: [{
                    tool_call_id: "send-1", name: "messenger_send_message",
                    parameters: { html_text: "Sunday works" },
                }] }], content: null });
            }
            const content = JSON.stringify({ status: "done" });
            return Expected.ok({ messages: [{ role: "assistant", content }], content });
        });
    }

    // 2. complete a tool round trip using a single context snapshot
    {
        context.emit("message", telegram_message(20, "@test_bot Answer"));
        await context.proceed();
        assert.equal(context.requests.length, 2);
        assert.equal(context.queries.length, 1);
        assert.ok(context.requests[1].some(message => message.role === "tool_calls"));
        assert.ok(context.requests[1].some(message => message.role === "tool_result"
            && message.tool_call_id === "send-1"));
    }

    // 3. persist the visible bot message and edit the original trigger
    {
        context.emit("edited_message", telegram_message(20, "Edited request"));
        await context.proceed();
        assert.equal(context.stored(1000).text, "Sunday works");
        assert.equal(context.requests.length, 2);
        assert.equal(context.queries.length, 1);
    }

    // 4. use current chat text without duplicating the previous internal history
    {
        context.emit("message", telegram_message(30, "@test_bot Explain"));
        await context.proceed();
        assert.equal(context.requests.length, 3);
        assert.equal(context.queries.length, 1);
        const request = context.requests[2];
        assert.ok(context_message(request, 20).endsWith("text:\nEdited request"));
        assert.ok(context_message(request, 1000).endsWith("text:\nSunday works"));
        assert.equal(request.find(message => message.content?.startsWith("id: 1000\n")).role,
            "assistant");
        assert.equal(request.some(message => message.role === "tool_calls"
            || message.role === "tool_result"), false);
        assert.equal(request.some(message => message.content === '{"status":"done"}'), false);
        assert.equal(new Set(context_ids(request)).size, context_ids(request).length);
    }
});

for (const failure of ["error", "throw"]) {
    test(`a sent bot reply remains successful when its persistence fails: ${failure}`, async t => {
        // Motivation: a backlog failure after Telegram delivery must not report
        // the messenger tool as failed or cause the delivered reply to be sent again.

        // 1. send a tool reply and fail persistence only for the outgoing message
        let context;
        const errors = [];
        let outgoing_writes = 0;
        {
            context = await fixture(t, async (_messages, _options, request) => {
                if (request === 1) {
                    return Expected.ok({ messages: [{ role: "tool_calls", calls: [{
                        tool_call_id: "send-1", name: "messenger_send_message",
                        parameters: { html_text: "Delivered answer" },
                    }] }], content: null });
                }
                const content = JSON.stringify({ status: "done" });
                return Expected.ok({ messages: [{ role: "assistant", content }], content });
            });
            const add_message = context.backlog.add_message.bind(context.backlog);
            mock.method(context.backlog, "add_message", async message => {
                if (message.message_id !== "1000") {
                    return await add_message(message);
                }
                outgoing_writes += 1;
                if (failure === "throw") {
                    throw new Error("Outgoing storage exception");
                }
                return Expected.err("Outgoing storage error");
            });
            mock.method(logger, "error", (...args) => errors.push(args));
        }

        // 2. complete the tool round trip despite the failed outgoing write
        {
            context.emit("message", telegram_message(20, "@test_bot Answer"));
            await context.proceed();
            assert.equal(context.requests.length, 2);
            const result = context.requests[1].find(message => message.role === "tool_result");
            assert.ok(result);
            assert.deepEqual(JSON.parse(result.result), { value: true });
            assert.equal(context.stored(1000), undefined);
            assert.equal(outgoing_writes, 1);
            assert.equal(errors.length, 1);
        }

        // 3. avoid retrying or replaying the delivered reply on the next tick
        {
            await context.proceed();
            assert.equal(context.requests.length, 2);
            assert.equal(outgoing_writes, 1);
        }
    });
}

test("queued mentions run one per tick and see the previous persisted bot reply", async t => {
    // Motivation: each tick must handle only one queued mention while keeping
    // tool round trips intact and retaining later mentions for subsequent ticks.

    // 1. create an LLM that sends a bot message during its first response
    let context;
    {
        context = await fixture(t, async (_messages, _options, request) => {
            if (request === 1) {
                return Expected.ok({ messages: [{ role: "tool_calls", calls: [{
                    tool_call_id: "send-1", name: "messenger_send_message",
                    parameters: { html_text: "First answer" },
                }] }], content: null });
            }
            const content = JSON.stringify({ status: "done" });
            return Expected.ok({ messages: [{ role: "assistant", content }], content });
        });
    }

    // 2. skip ordinary messages and handle only the first queued mention
    {
        context.emit("message", telegram_message(10, "Ordinary conversation"));
        context.emit("message", telegram_message(20, "@test_bot First question"));
        context.emit("message", telegram_message(25, "Another ordinary message"));
        context.emit("message", telegram_message(30, "@test_bot Follow-up"));
        await context.proceed();
        assert.equal(context.requests.length, 2);
    }

    // 3. handle the next mention with the persisted bot reply exactly once
    {
        await context.proceed();
        assert.equal(context.requests.length, 3);
        assert.equal(context.queries.length, 1);
        assert.equal(context.stored(1000).text, "First answer");
        const request = context.requests[2];
        assert.ok(context_message(request, 1000).endsWith("text:\nFirst answer"));
        assert.equal(context_ids(request).filter(id => id === "1000").length, 1);
        assert.equal(request.some(message => message.role === "tool_result"), false);
    }

    // 4. leave no duplicate responses after the queue has been consumed
    {
        await context.proceed();
        assert.equal(context.requests.length, 3);
    }
});

test("a failed response still leaves the next mention for another tick", async t => {
    // Motivation: the per-tick limit must also apply to failed model requests
    // so a failure cannot consume the rest of the queued bot messages.

    // 1. configure the first model request to fail
    let context;
    {
        context = await fixture(t, async (_messages, _options, request) => {
            if (request === 1) {
                return Expected.err("Temporary model failure");
            }
            const content = JSON.stringify({ status: "done" });
            return Expected.ok({ messages: [{ role: "assistant", content }], content });
        });
    }

    // 2. attempt only the first of two queued mentions
    {
        context.emit("message", telegram_message(20, "@test_bot First question"));
        context.emit("message", telegram_message(30, "@test_bot Second question"));
        await context.proceed();
        assert.equal(context.requests.length, 1);
    }

    // 3. process the remaining mention on the next tick without replaying either
    {
        await context.proceed();
        assert.equal(context.requests.length, 2);
        await context.proceed();
        assert.equal(context.requests.length, 2);
    }
});

test("Telegram processing and LLM context do not wait for a pending Firestore write", { timeout: 3000 }, async t => {
    // Motivation: awaiting backlog acceptance from the main loop must only
    // wait for a local change, even when the database write has not completed.

    // 1. keep the remote write pending after the cache has accepted a message
    let context;
    let release;
    let entered;
    {
        context = await fixture(t);
        let mark_entered;
        const blocked = new Promise(resolve => { release = resolve; });
        entered = new Promise(resolve => { mark_entered = resolve; });
        context.block_writes(async () => { mark_entered(); await blocked; });
        t.after(() => release());
    }

    // 2. finish adapter processing and respond with the locally accepted message
    {
        context.emit("message", telegram_message(20, "@test_bot Answer"));
        await context.proceed();
        await entered;
        assert.equal(context.stored(20), undefined);
        assert.equal(context.requests.length, 1);
        assert.deepEqual(context_ids(context.requests[0]), ["20"]);
    }

    // 3. allow persistence to finish without replaying the bot response
    {
        release();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(context.stored(20).text, "@test_bot Answer");
        await context.proceed();
        assert.equal(context.requests.length, 1);
    }
});

test("failed background writes retain local context without retrying persistence", async t => {
    // Motivation: background persistence is best effort; a failed write must
    // remain visible in local context without replaying the response or write.

    // 1. make the backlog reject a newly received bot mention
    let context;
    {
        context = await fixture(t);
        context.fail_writes(new Error("Write unavailable"));
        context.emit("message", telegram_message(20, "@test_bot Answer"));
    }

    // 2. respond using the locally accepted message despite the failed write
    {
        await context.proceed();
        assert.equal(context.stored(20), undefined);
        assert.equal(context.queries.length, 1);
        assert.equal(context.requests.length, 1);
    }

    // 3. continue with new messages without retrying the discarded write
    {
        context.fail_writes(undefined);
        await context.proceed();
        assert.equal(context.stored(20), undefined);
        assert.equal(context.requests.length, 1);
        context.emit("message", telegram_message(30, "@test_bot Next question"));
        await context.proceed();
        assert.equal(context.requests.length, 2);
        assert.deepEqual(context_ids(context.requests[1]), ["20", "30"]);
    }
});

test("context requests resolve shared chains in batches and terminate at cycles and missing originals", async t => {
    // Motivation: several recent messages can share ancestry; context
    // resolution must avoid duplicates and terminate even with broken links.

    // 1. create a chat and a shared cyclic chain beyond the history window
    let context;
    let records;
    {
        context = await fixture(t);
        const old = new Date(Date.now() - 10 * 86400_000);
        records = [
            { message_id: "10", time: old, text: "@test_bot Old parent", reply_to: "5" },
            { message_id: "5", time: old, text: "Old ancestor", reply_to: "10" },
            { message_id: "20", time: new Date(Date.now() - 120_000), text: "First reply", reply_to: "10" },
            { message_id: "30", time: new Date(Date.now() - 90_000), text: "Second reply", reply_to: "10" },
            { message_id: "40", time: new Date(Date.now() - 80_000), text: "Missing parent", reply_to: "missing" },
        ];
    }

    // 2. save the history before recreating the managers agent
    for (const record of records) {
        assert.equal((await context.create_backlog().add_message({
            ...record, sender_id: "original-author",
        })).ok, true);
    }

    // 3. restart without reading history or requesting an LLM response
    {
        await context.restart();
        assert.equal(context.requests.length, 0);
        assert.equal(context.id_queries.length, 0);
        assert.equal(context.queries.length, 0);
    }

    // 4. load the context with ancestors before the recent messages
    {
        context.emit("message", telegram_message(50, "@test_bot Summarize"));
        await context.proceed();
        assert.equal(context.id_queries.length, 2);
        assert.equal(context.id_queries[0].length, 2);
        assert.ok(context.id_queries[0].includes("10"));
        assert.deepEqual(context.id_queries[1], ["5"]);
        const ids = context_ids(context.requests[0]);
        assert.deepEqual(new Set(ids.slice(0, 2)), new Set(["10", "5"]));
        assert.deepEqual(ids.slice(2), ["20", "30", "40", "50"]);
        assert.equal(new Set(ids).size, ids.length);
        assert.equal(reply_reference(context_message(context.requests[0], 40)), "missing");
    }
});

test("context snapshots keep reachable chains and drop chains after all recent replies expire", async t => {
    // Motivation: a fresh reply must keep shared old ancestors after earlier
    // roots expire, without changing original dates or retaining orphan chains.

    // 1. save an old chain and a reply near the edge of the history window
    let context;
    let now;
    let old_time;
    {
        now = Date.now();
        context = await fixture(t);
        old_time = new Date(now - 10 * 86400_000);
        const backlog = context.create_backlog();
        assert.equal((await backlog.add_message({ time: old_time, message_id: "10",
            sender_id: "original-author", text: "Parent", reply_to: "5" })).ok, true);
        assert.equal((await backlog.add_message({ time: old_time, message_id: "5",
            sender_id: "original-author", text: "Ancestor", reply_to: null })).ok, true);
        context.emit("message", telegram_message(20, "Older reply", {
            date: Math.floor((now - 2 * 86400_000) / 1000), reply_to_message: { message_id: 10 },
        }));
        await context.proceed();
        assert.deepEqual(context.id_queries, []);
    }

    // 2. save a fresh unmentioned reply without reading the chain
    {
        now += 12 * 3600_000;
        mock.method(Date, "now", () => now);
        context.emit("message", telegram_message(30, "Fresh reply", { reply_to_message: { message_id: 10 } }));
        await context.proceed();
        assert.equal(context.requests.length, 0);
        assert.equal(context.id_queries.length, 0);
    }

    // 3. retain both ancestors after the first root expires, without duplicates
    {
        now += 2 * 86400_000;
        context.emit("message", telegram_message(40, "@test_bot Summarize"));
        await context.proceed();
        const ids = context_ids(context.requests[0]);
        assert.deepEqual(new Set(ids), new Set(["5", "10", "30", "40"]));
        assert.equal(new Set(ids).size, ids.length);
        assert.equal(context.id_queries.length, 2);
        assert.equal(context.stored(10).time.getTime(), old_time.getTime());
        assert.equal(context.stored(5).time.getTime(), old_time.getTime());
        const original_date = `${String(old_time.getDate()).padStart(2, "0")}.`
            + String(old_time.getMonth() + 1).padStart(2, "0");
        assert.ok(context_message(context.requests[0], 10).includes(`\ntime: ${original_date},`));
        assert.ok(context_message(context.requests[0], 5).includes(`\ntime: ${original_date},`));
    }

    // 4. remove the whole chain when no recent message reaches it
    {
        now += 4 * 86400_000;
        context.emit("message", telegram_message(50, "@test_bot New topic"));
        await context.proceed();
        assert.ok(context.stored(50));
        assert.equal(context.queries.length, 1);
        assert.deepEqual(context_ids(context.requests[1]), ["50"]);
        assert.equal(context.id_queries.length, 2);
    }

    // 5. load the chain again on demand after another reply references it
    {
        context.emit("message", telegram_message(60, "Another reply", { reply_to_message: { message_id: 10 } }));
        await context.proceed();
        assert.equal(context.requests.length, 2);
        assert.deepEqual(context.id_queries, [["10"], ["5"]]);
        context.emit("message", telegram_message(70, "@test_bot Summarize again"));
        await context.proceed();
        const ids = context_ids(context.requests[2]);
        assert.deepEqual(context.id_queries, [["10"], ["5"]]);
        assert.deepEqual(new Set(ids), new Set(["5", "10", "50", "60", "70"]));
        assert.equal(new Set(ids).size, ids.length);
    }
});

test("a failed context lookup retains the queued reply and retries with a fresh snapshot", async t => {
    // Motivation: a failed snapshot must prevent an incomplete LLM request and
    // allow the queued trigger to be handled when storage becomes available.

    // 1. save an old chain and fail only the ancestor lookup
    let context;
    {
        context = await fixture(t);
        const time = new Date(Date.now() - 10 * 86400_000);
        const backlog = context.create_backlog();
        assert.equal((await backlog.add_message({ time, message_id: "10",
            sender_id: "original-author", text: "Parent", reply_to: "5" })).ok, true);
        assert.equal((await backlog.add_message({ time, message_id: "5",
            sender_id: "original-author", text: "Ancestor", reply_to: null })).ok, true);
        context.fail_id_reads(ids => ids.includes("5") ? new Error("Temporary read failure") : undefined);
    }

    // 2. defer processing the reply while the chain is incomplete
    {
        context.emit("message", telegram_message(20, "@test_bot Summarize", { reply_to_message: { message_id: 10 } }));
        context.emit("message", telegram_message(30, "@test_bot Follow-up"));
        const status = await context.proceed(false);
        assert.match(status.error, /Temporary read failure/);
        assert.equal(context.requests.length, 0);
        assert.deepEqual(context.id_queries, [["10"], ["5"]]);
    }

    // 3. rebuild the snapshot and retry only the original queued reply
    {
        context.fail_id_reads(undefined);
        await context.proceed();
        assert.equal(context.requests.length, 1);
        assert.deepEqual(context.id_queries, [["10"], ["5"], ["5"]]);
        assert.deepEqual(new Set(context_ids(context.requests[0])), new Set(["5", "10", "20", "30"]));
    }

    // 4. process the next mention on another tick without losing or replaying it
    {
        await context.proceed();
        assert.equal(context.requests.length, 2);
        await context.proceed();
        assert.equal(context.requests.length, 2);
    }
});

for (const chat_type of ["group", "supergroup"]) {
    test(`editing a reply in a ${chat_type} preserves its metadata and does not trigger the bot`, async t => {
        // Motivation: Telegram edits can omit reply details; the edit route
        // must change stored text without clearing the relationship or replying.

        // 1. store a reply through the Telegram event path
        let context;
        let reply;
        let snapshot;
        {
            context = await fixture(t);
            reply = telegram_message(20, "Yes", {
                chat: { id: managers_chat_id, type: chat_type },
                reply_to_message: telegram_message(10, "Proposal", { from: original_author }),
            });
            context.emit("message", reply);
            await context.proceed();
            snapshot = structuredClone(context.stored(20).reply_to);
        }

        // 2. persist an edit that omits reply metadata, even with a bot mention
        {
            const { reply_to_message, ...edited } = reply;
            context.emit("edited_message", { ...edited, text: "@test_bot I agree with Sunday" });
            await context.proceed();
            assert.equal(context.stored(20).text, "@test_bot I agree with Sunday");
            assert.deepEqual(context.stored(20).reply_to, snapshot);
            assert.deepEqual(context.updates, [{ text: "@test_bot I agree with Sunday" }]);
            assert.equal(context.requests.length, 0);
        }

        // 3. ignore edits in another chat or a topic of the managers chat
        {
            context.emit("edited_message", { ...reply, text: "Other chat",
                chat: { id: -200, type: chat_type } });
            context.emit("edited_message", { ...reply, text: "Other topic", message_thread_id: 7 });
            await context.proceed();
            assert.equal(context.updates.length, 1);
        }

        // 4. confirm the edited text and original relationship survive reload
        {
            await context.restart();
            context.emit("message", telegram_message(30, "@test_bot Summarize"));
            await context.proceed();
            const restored = context_message(context.requests[0], 20);
            assert.ok(restored.endsWith("text:\n@test_bot I agree with Sunday"));
            assert.equal(reply_reference(restored), snapshot);
        }
    });
}

test("unavailable originals remain ID references without copying Telegram snapshots", async t => {
    // Motivation: originals can be media or come from unregistered people or
    // channels; missing saved messages must not break replies or create data.

    // 1. create a managers chat with several partially available originals
    let context;
    let cases;
    {
        context = await fixture(t);
        cases = [
            { original: { message_id: 10 }, expected: "10" },
            { original: { message_id: 11, caption: "Rehearsal plan", from: { id: 789,
                first_name: "Unknown" } }, expected: "11" },
            { original: { message_id: 12, text: "Channel proposal", from: sender,
                sender_chat: { id: -456, title: "Choir channel", username: "choir" } },
            expected: "12" },
        ];
    }

    // 2. persist each relationship and omit text and captions from LLM metadata
    for (const [index, item] of cases.entries()) {
        context.emit("message", telegram_message(20 + index, "@test_bot Yes", {
            reply_to_message: item.original,
        }));
        await context.proceed();
        assert.equal(context.stored(20 + index).reply_to, item.expected);
        assert.equal(reply_reference(context_message(context.requests.at(-1), 20 + index)),
            item.expected);
        assert.equal(context.id_queries.length, index + 1);
        assert.equal(context.id_queries.at(-1).length, index + 1);
    }
});

test("batch lookup handles duplicate, missing, and empty IDs and propagates read failures", async () => {
    // Motivation: callers must distinguish missing messages from storage errors,
    // while requesting many references without a separate read for each ID.

    // 1. store messages outside the normal history range
    let context;
    let backlog;
    {
        context = firestore_fixture();
        backlog = context.create_backlog();
        const time = new Date(Date.now() - 10 * 86400_000);
        assert.equal((await backlog.add_message({
            time, message_id: "first", sender_id: "author", text: "First", reply_to: null,
        })).ok, true);
        assert.equal((await backlog.add_message({
            time, message_id: "second", sender_id: "author", text: "Second", reply_to: "first",
        })).ok, true);
        assert.equal(context.stored("first").schema, 1);
        assert.equal(context.stored("first").sender_id, "author");
        assert.equal(Object.hasOwn(context.stored("first"), "sender"), false);
        assert.equal((await backlog.add_message({
            time, message_id: "legacy", sender_id: "old-author", text: "Old message",
        })).ok, true);
        const legacy = context.stored("legacy");
        legacy.sender = legacy.sender_id;
        delete legacy.sender_id;
        delete legacy.schema;
    }

    // 2. fetch a set in one request, returning each existing message once
    {
        const result = await backlog.get_messages_by_ids(["second", "missing", "first", "second", "legacy"]);
        assert.equal(result.ok, true);
        assert.deepEqual(result.value.map(message => message.message_id), ["second", "first", "legacy"]);
        assert.equal(result.value[0].reply_to, "first");
        assert.equal(result.value[1].reply_to, null);
        assert.equal(Object.hasOwn(result.value[2], "reply_to"), false);
        assert.equal(result.value[2].sender_id, "old-author");
        assert.ok(result.value[0].time instanceof Date);
        assert.equal(context.id_queries.length, 1);
        assert.equal(context.id_queries[0].length, 4);
    }

    // 3. skip storage completely for an empty set
    {
        const result = await backlog.get_messages_by_ids([]);
        assert.equal(result.ok, true);
        assert.deepEqual(result.value, []);
        assert.equal(context.id_queries.length, 1);
    }

    // 4. return a failed storage lookup as an error
    {
        context.fail_id_reads(new Error("Firestore unavailable"));
        const result = await backlog.get_messages_by_ids(["first"]);
        assert.equal(result.ok, false);
        assert.match(result.error, /Firestore unavailable/);
    }

    // 5. reject unknown schema versions through both storage read APIs
    {
        context.fail_id_reads(undefined);
        context.stored("first").schema = 99;
        const by_ids = await backlog.get_messages_by_ids(["first"]);
        assert.equal(by_ids.ok, false);
        assert.match(by_ids.error, /Unsupported message schema: 99/);
        const by_time = await backlog.get_messages(new Date(0), new Date());
        assert.equal(by_time.ok, false);
        assert.match(by_time.error, /Unsupported message schema: 99/);
    }
});

test("legacy metadata stays unknown while ordinary messages are explicitly non-replies", async t => {
    // Motivation: absent metadata in old Firestore records is not evidence
    // that a message was not a reply, and text must never create a link.
    // Agent context includes reply_to only when the target id is known.

    // 1. store an old record without metadata alongside a new ordinary message
    let context;
    {
        context = await fixture(t);
        const result = await context.create_backlog().add_message({
            time: new Date(Date.now() - 120_000), message_id: "legacy", sender_id: "old-author",
            text: "Yes, I agree. reply_to: 10",
        });
        assert.equal(result.ok, true);
        const legacy = context.stored("legacy");
        legacy.sender = legacy.sender_id;
        delete legacy.sender_id;
        delete legacy.schema;
        assert.equal(Object.hasOwn(context.stored("legacy"), "reply_to"), false);
        context.emit("message", telegram_message(20, "Yes, I agree. reply_to: 10"));
        await context.proceed();
        assert.equal(context.stored(20).reply_to, null);
        assert.equal(context.requests.length, 0);
    }

    // 2. reload both records and omit reply_to unless the target id is known
    {
        await context.restart();
        context.emit("message", telegram_message(30, "@test_bot Summarize"));
        await context.proceed();
        const request = context.requests[0];
        assert.equal(Object.hasOwn(context.stored("legacy"), "reply_to"), false);
        assert.equal(context.stored(20).reply_to, null);
        assert.equal(reply_reference(context_message(request, "legacy")), undefined);
        assert.equal(reply_reference(context_message(request, 20)), undefined);
        assert.match(context_message(request, "legacy"), /text:\nYes, I agree\. reply_to: 10$/);
    }
});
