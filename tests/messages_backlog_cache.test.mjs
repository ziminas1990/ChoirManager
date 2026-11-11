import { MemoryJournal } from "../dist/components/memory_journal.js";
import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

import { MessagesBacklogCache } from "../dist/components/messages_backlog_cache.js";
import { Expected } from "../dist/utils/expected.js";

const journal = new MemoryJournal();

afterEach(() => { mock.restoreAll(); journal.clear(); });

const day = 86400_000;

function message(message_id, time, reply_to = null) {
    return { message_id, time: new Date(time), sender_id: "author", text: message_id, reply_to };
}

function source_fixture(messages = []) {
    const records = new Map(messages.map(message => [message.message_id, structuredClone(message)]));
    const ranges = [];
    const ids = [];
    const failures = {};
    let range_hook;
    return {
        records, ranges, ids, failures,
        block_range(hook) { range_hook = hook; },
        async init() {
            return failures.init ? Expected.err(failures.init) : Expected.ok(undefined);
        },
        async add_message(message) {
            if (failures.add) {
                return Expected.err(failures.add);
            }
            records.set(message.message_id, structuredClone(message));
            return Expected.ok(undefined);
        },
        async update_message(message) {
            if (failures.update) {
                return Expected.err(failures.update);
            }
            const record = records.get(message.message_id);
            if (!record) {
                return Expected.err("missing message");
            }
            record.text = message.text;
            return Expected.ok(undefined);
        },
        async get_messages(from, to) {
            ranges.push({ from, to });
            if (failures.range) {
                return Expected.err(failures.range);
            }
            const selected = structuredClone([...records.values()].filter(
                message => message.time >= from && message.time <= to,
            ));
            if (range_hook) {
                await range_hook();
            }
            return Expected.ok(selected);
        },
        async get_messages_by_ids(requested) {
            ids.push(requested);
            if (failures.ids) {
                return Expected.err(failures.ids);
            }
            return Expected.ok(structuredClone(requested.flatMap(id => records.has(id) ? [records.get(id)] : [])));
        },
    };
}

function value(result) {
    assert.equal(result.ok, true, result.ok ? undefined : result.error);
    return result.value;
}

test("backlog cache lazily loads its whole window once and serves later subranges from memory", async () => {
    // Motivation: ChatContext requests a smaller window than the cache holds;
    // later requests and ID hits must reuse the complete cached history.

    // 1. create a five-day cache with messages beyond the initial requested range
    let now;
    let source;
    let cache;
    {
        now = Date.parse("2026-11-10T12:00:00Z");
        mock.method(Date, "now", () => now);
        source = source_fixture([
            message("older", now - 4 * day),
            message("recent", now - day),
        ]);
        cache = new MessagesBacklogCache(source, 5, journal);
        value(await cache.init());
        assert.deepEqual(source.ranges, []);
    }

    // 2. load the whole cache window while returning only the requested messages
    {
        const result = value(await cache.get_messages(new Date(now - 2 * day), new Date(now)));
        assert.deepEqual(result.map(message => message.message_id), ["recent"]);
        assert.equal(source.ranges.length, 1);
        assert.equal(source.ranges[0].from.toISOString(), "2026-11-05T00:00:00.000Z");
        assert.equal(source.ranges[0].to.getTime(), now);
        result[0].text = "Caller mutation";
        result[0].time.setTime(0);
    }

    // 3. answer a wider range and ID queries without exposing mutable cache data
    {
        now += 60_000;
        const result = value(await cache.get_messages(new Date(now - 5 * day), new Date(now)));
        assert.deepEqual(result.map(message => message.message_id), ["older", "recent"]);
        assert.equal(result[1].text, "recent");
        assert.equal(result[1].time.getTime(), source.records.get("recent").time.getTime());
        const by_id = value(await cache.get_messages_by_ids(["older", "older", "recent"]));
        assert.deepEqual(by_id.map(message => message.message_id), ["older", "recent"]);
        by_id[0].text = "Another caller mutation";
        assert.equal(value(await cache.get_messages_by_ids(["older"]))[0].text, "older");
        assert.equal(source.ranges.length, 1);
        assert.deepEqual(source.ids, []);
    }
});

test("backlog cache applies local adds and text edits despite background write failures", async () => {
    // Motivation: local changes must remain visible independently of remote
    // persistence, and text edits must preserve original reply metadata.

    // 1. load a reply whose relationship must survive edits without metadata
    let now;
    let source;
    let cache;
    {
        now = Date.parse("2026-11-10T12:00:00Z");
        mock.method(Date, "now", () => now);
        source = source_fixture([message("reply", now - day, "parent")]);
        cache = new MessagesBacklogCache(source, 5, journal);
        value(await cache.get_messages(new Date(now - 3 * day), new Date(now)));
    }

    // 2. accept a new message and a text edit before the next snapshot
    {
        const added = message("new", now);
        value(await cache.add_message(added));
        added.text = "Caller mutation";
        const edit = { ...message("reply", 0), sender_id: "wrong", text: "Edited" };
        delete edit.reply_to;
        value(await cache.update_message(edit));
        const result = value(await cache.get_messages(new Date(now - 3 * day), new Date(now)));
        assert.deepEqual(result.map(message => message.text), ["Edited", "new"]);
        assert.equal(result[0].reply_to, "parent");
        assert.equal(result[0].time.getTime(), now - day);
        assert.equal(result[0].sender_id, "author");
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(source.records.get("reply").text, "Edited");
        assert.equal(source.ranges.length, 1);
    }

    // 3. retain local changes and log failed background writes without retrying
    {
        source.failures.add = "add failed";
        source.failures.update = "edit failed";
        value(await cache.add_message(message("failed", now)));
        value(await cache.update_message({ ...message("reply", now), text: "Failed edit" }));
        const result = value(await cache.get_messages(new Date(now - 3 * day), new Date(now)));
        assert.deepEqual(result.map(message => message.text), ["Failed edit", "new", "failed"]);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(journal.records.filter(record => record.level === "error").length, 2);
        assert.equal(source.records.has("failed"), false);
        assert.equal(source.records.get("reply").text, "Edited");
        assert.equal(source.ranges.length, 1);
    }
});

test("backlog cache evicts expired window messages and retains every requested original", async () => {
    // Motivation: ordinary history should age out of memory, while messages
    // requested by ID must remain reusable after they leave the cache window.

    // 1. load window messages and pin both a cached hit and an old ID lookup
    let now;
    let source;
    let cache;
    {
        now = Date.parse("2026-11-10T12:00:00Z");
        mock.method(Date, "now", () => now);
        source = source_fixture([
            message("ordinary", now - day),
            message("pinned-hit", now - day),
            message("old-original", now - 10 * day),
        ]);
        cache = new MessagesBacklogCache(source, 5, journal);
        value(await cache.get_messages(new Date(now - 3 * day), new Date(now)));
        const result = value(await cache.get_messages_by_ids(["pinned-hit", "old-original"]));
        assert.equal(result.length, 2);
        assert.deepEqual(source.ids, [["old-original"]]);
    }

    // 2. advance beyond the cache window without retaining old window roots
    {
        now += 7 * day;
        assert.deepEqual(value(await cache.get_messages(new Date(now - 3 * day), new Date(now))), []);
        const result = value(await cache.get_messages_by_ids(["pinned-hit", "old-original"]));
        assert.equal(result.length, 2);
        assert.deepEqual(source.ids, [["old-original"]]);
        assert.equal(source.ranges.length, 1);
    }

    // 3. fetch an unpinned expired message again instead of keeping it forever
    {
        assert.equal(value(await cache.get_messages_by_ids(["ordinary"]))[0].message_id, "ordinary");
        assert.deepEqual(source.ids, [["old-original"], ["ordinary"]]);
    }
});

test("backlog cache merges local edits into a slow initial snapshot without loading twice", async () => {
    // Motivation: writes must complete without waiting for an initial read,
    // whose old snapshot must not overwrite concurrent local changes.

    // 1. block the initial history read after storage captures an old snapshot
    let now;
    let cache;
    let source;
    let release;
    let entered;
    {
        now = Date.now();
        mock.method(Date, "now", () => now);
        source = source_fixture([message("reply", now - 1000, "parent")]);
        cache = new MessagesBacklogCache(source, 5, journal);
        const blocked = new Promise(resolve => { release = resolve; });
        let mark_entered;
        entered = new Promise(resolve => { mark_entered = resolve; });
        source.block_range(async () => { mark_entered(); await blocked; });
    }

    // 2. accept an edit and a new message before releasing the initial read
    let first;
    let edit;
    let second;
    {
        first = cache.get_messages(new Date(now - day), new Date(now));
        await entered;
        edit = await cache.update_message({ ...message("reply", 0), text: "Concurrent edit" });
        value(edit);
        value(await cache.add_message(message("new", now - 500)));
        second = cache.get_messages(new Date(now - day), new Date(now));
        release();
    }

    // 3. return the updated message to the later reader using the initial load
    {
        const updated = value(await first)[0];
        assert.equal(updated.text, "Concurrent edit");
        assert.equal(updated.time.getTime(), now - 1000);
        assert.equal(updated.reply_to, "parent");
        assert.deepEqual(value(await second).map(message => message.text), ["Concurrent edit", "new"]);
        assert.equal(source.ranges.length, 1);
    }
});

test("backlog cache retries failed loads and missing IDs without returning partial success", async () => {
    // Motivation: a failed warmup must remain retryable, and an unavailable
    // original must not be permanently mistaken for a missing record.

    // 1. create a cache whose initialization and first window read fail
    let now;
    let source;
    let cache;
    {
        now = Date.now();
        mock.method(Date, "now", () => now);
        source = source_fixture([message("recent", now - 1000)]);
        cache = new MessagesBacklogCache(source, 5, journal);
        source.failures.init = "init failed";
        assert.equal((await cache.init()).ok, false);
        delete source.failures.init;
        value(await cache.init());
        source.failures.range = "range failed";
        assert.equal((await cache.get_messages(new Date(now - day), new Date(now))).ok, false);
    }

    // 2. retry the window read successfully and handle empty ID requests locally
    {
        delete source.failures.range;
        assert.equal(value(await cache.get_messages(new Date(now - day), new Date(now))).length, 1);
        assert.deepEqual(value(await cache.get_messages_by_ids([])), []);
        assert.equal(source.ranges.length, 2);
        assert.deepEqual(source.ids, []);
    }

    // 3. return an error for a failed ID miss even when some IDs are cached
    {
        source.failures.ids = "ID read failed";
        const result = await cache.get_messages_by_ids(["recent", "missing", "missing"]);
        assert.equal(result.ok, false);
        assert.match(result.error, /ID read failed/);
        assert.deepEqual(source.ids, [["missing"]]);
    }

    // 4. allow a missing original to become available on a later lookup
    {
        delete source.failures.ids;
        assert.deepEqual(value(await cache.get_messages_by_ids(["missing"])), []);
        source.records.set("missing", message("missing", now - 20 * day));
        assert.equal(value(await cache.get_messages_by_ids(["recent", "missing"])).length, 2);
        assert.deepEqual(source.ids, [["missing"], ["missing"], ["missing"]]);
    }
});

test("backlog cache delegates ranges outside its window instead of returning incomplete history", async () => {
    // Motivation: implementing IMessagesBacklog must preserve arbitrary range
    // reads even when only a shorter window has been loaded into memory.

    // 1. warm a cache containing only recent history
    let now;
    let source;
    let cache;
    {
        now = Date.now();
        mock.method(Date, "now", () => now);
        source = source_fixture([
            message("old", now - 10 * day),
            message("recent", now - day),
            message("future", now + day),
        ]);
        cache = new MessagesBacklogCache(source, 5, journal);
        value(await cache.get_messages(new Date(now - 3 * day), new Date(now)));
    }

    // 2. fetch the full requested history and future range from storage
    {
        const result = value(await cache.get_messages(new Date(now - 20 * day), new Date(now + 2 * day)));
        assert.deepEqual(result.map(message => message.message_id), ["old", "recent", "future"]);
        assert.equal(source.ranges.length, 2);
    }

    // 3. merge local changes into delegated reads even when persistence fails
    {
        source.failures.add = "Create failed";
        source.failures.update = "Update failed";
        value(await cache.add_message(message("local", now - 500)));
        value(await cache.update_message({ ...message("recent", 0), text: "Edited" }));
        await new Promise(resolve => setImmediate(resolve));
        const result = value(await cache.get_messages(new Date(now - 20 * day), new Date(now + 2 * day)));
        assert.deepEqual(result.map(message => message.text), ["old", "Edited", "local", "future"]);
        assert.equal(source.records.has("local"), false);
        assert.equal(source.records.get("recent").text, "recent");
    }
});

test("slow background writes do not delay local mutations or cached reads", { timeout: 2000 }, async t => {
    // Motivation: a blocked remote create must leave foreground processing
    // responsive while preserving write order and isolated message snapshots.

    // 1. warm a cache and block its first remote create
    let cache;
    let source;
    let release;
    let entered;
    let completed;
    const attempts = [];
    const now = Date.now();
    {
        source = source_fixture([message("recent", now - day)]);
        let mark_entered;
        let mark_completed;
        const blocked = new Promise(resolve => { release = resolve; });
        entered = new Promise(resolve => { mark_entered = resolve; });
        completed = new Promise(resolve => { mark_completed = resolve; });
        const add = source.add_message.bind(source);
        const update = source.update_message.bind(source);
        source.add_message = async saved => {
            attempts.push(`add:${saved.message_id}:start`);
            if (saved.message_id === "first") {
                mark_entered();
                await blocked;
            }
            const result = await add(saved);
            attempts.push(`add:${saved.message_id}:done`);
            if (saved.message_id === "second") {
                mark_completed();
            }
            return result;
        };
        source.update_message = async saved => {
            attempts.push(`update:${saved.message_id}`);
            return await update(saved);
        };
        cache = new MessagesBacklogCache(source, 5, journal);
        value(await cache.get_messages(new Date(now - 2 * day), new Date(now)));
        t.after(() => release());
    }

    // 2. accept multiple operations before allowing the first write to finish
    {
        const first = message("first", now - 500, "parent");
        value(await cache.add_message(first));
        await entered;
        first.text = "Caller mutation";
        first.time.setTime(0);
        const edit = { ...message("first", 0), sender_id: "wrong", text: "Edited" };
        value(await cache.update_message(edit));
        edit.text = "Another caller mutation";
        value(await cache.add_message(message("second", now - 100)));
        assert.deepEqual(attempts, ["add:first:start"]);
        assert.equal(source.records.has("first"), false);
    }

    // 3. expose accepted messages immediately without waiting for remote writes
    {
        const result = value(await cache.get_messages(new Date(now - 2 * day), new Date(now)));
        assert.deepEqual(result.map(message => message.text), ["recent", "Edited", "second"]);
        const first = value(await cache.get_messages_by_ids(["first"]))[0];
        assert.equal(first.text, "Edited");
        assert.equal(first.time.getTime(), now - 500);
        assert.equal(first.sender_id, "author");
        assert.equal(first.reply_to, "parent");
        assert.equal(source.ranges.length, 1);
        assert.deepEqual(source.ids, []);
    }

    // 4. persist captured operations in order after unblocking the create
    {
        release();
        await completed;
        assert.deepEqual(attempts, ["add:first:start", "add:first:done",
            "update:first", "add:second:start", "add:second:done"]);
        assert.equal(source.records.get("first").text, "Edited");
        assert.equal(source.records.get("first").time.getTime(), now - 500);
    }
});

test("background failures are logged once and do not stop later writes", async () => {
    // Motivation: status failures and rejected promises must not poison the
    // background queue or roll back locally accepted messages and edits.

    // 1. fail one remote create and throw from one remote edit
    let source;
    let cache;
    const attempts = [];
    const now = Date.now();
    {
        source = source_fixture([message("reply", now - 1000, "parent")]);
        const add = source.add_message.bind(source);
        source.add_message = async saved => {
            attempts.push(`add:${saved.message_id}`);
            return saved.message_id === "failed" ? Expected.err("Create failed") : await add(saved);
        };
        source.update_message = async saved => {
            attempts.push(`update:${saved.message_id}`);
            throw new Error("Update failed");
        };
        cache = new MessagesBacklogCache(source, 5, journal);
        value(await cache.get_messages(new Date(now - day), new Date(now)));
    }

    // 2. accept every local operation and let all background attempts finish
    {
        value(await cache.add_message(message("failed", now - 500)));
        value(await cache.update_message({ ...message("reply", 0), text: "Edited" }));
        value(await cache.add_message(message("ok", now - 100)));
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(attempts, ["add:failed", "update:reply", "add:ok"]);
        assert.equal(journal.records.filter(record => record.level === "error").length, 2);
        assert.equal(source.records.has("failed"), false);
        assert.equal(source.records.has("ok"), true);
    }

    // 3. retain local changes without retrying failures on subsequent reads
    {
        const result = value(await cache.get_messages(new Date(now - day), new Date(now)));
        assert.deepEqual(result.map(message => message.text), ["Edited", "failed", "ok"]);
        value(await cache.get_messages_by_ids(["failed", "reply"]));
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(attempts.length, 3);
        assert.equal(journal.records.filter(record => record.level === "error").length, 2);
    }
});

test("an ID snapshot preserves concurrent local edits and messages missing from storage", async () => {
    // Motivation: reply-chain lookups can race with local changes and return
    // stale or missing records before background persistence has completed.

    // 1. capture an old ID snapshot and delay its delivery
    let cache;
    let release;
    let entered;
    const now = Date.now();
    {
        const source = source_fixture([message("original", now - 10 * day, "parent")]);
        const read = source.get_messages_by_ids.bind(source);
        let mark_entered;
        const blocked = new Promise(resolve => { release = resolve; });
        entered = new Promise(resolve => { mark_entered = resolve; });
        source.get_messages_by_ids = async ids => {
            const snapshot = await read(ids);
            mark_entered();
            await blocked;
            return snapshot;
        };
        cache = new MessagesBacklogCache(source, 5, journal);
    }

    // 2. change local state after storage has captured its snapshot
    let pending;
    {
        pending = cache.get_messages_by_ids(["original", "new"]);
        await entered;
        value(await cache.update_message({ ...message("original", 0), sender_id: "wrong", text: "Edited" }));
        value(await cache.add_message(message("new", now)));
        release();
    }

    // 3. merge authoritative metadata with local text and include the new message
    {
        const result = value(await pending);
        assert.deepEqual(result.map(message => message.text), ["Edited", "new"]);
        assert.equal(result[0].time.getTime(), now - 10 * day);
        assert.equal(result[0].sender_id, "author");
        assert.equal(result[0].reply_to, "parent");
    }
});
