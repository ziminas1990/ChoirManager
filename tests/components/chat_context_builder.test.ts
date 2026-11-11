import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

import { ChatContextBuilder } from "@src/components/chat_context_builder.js";
import { Message } from "@src/interfaces/messages_backlog.js";

import { live_messages_backlog as backlog_fixture } from "@tests/mocks/live_messages_backlog.js";

afterEach(() => mock.restoreAll());

const day = 86400_000;

function message(message_id: string, time: number, reply_to: string | null | undefined): Message {
    return { message_id, time: new Date(time), reply_to, sender_id: "author", text: message_id };
}

test("ChatContextBuilder returns ordered window messages and complete shared reply chains", async () => {
    // Motivation: context selection belongs to this component and must handle
    // shared ancestors, cycles and missing records without omitting recent
    // chat.

    // 1. construct an unsorted history with shared and broken links
    let now: number;
    let backlog;
    let context;
    let records;
    {
        now = Date.now();
        mock.method(Date, "now", () => now);
        records = [
            message("recent-2", now - 1000, "parent"),
            message("parent", now - 5 * day, "ancestor"),
            message("unrelated", now - 6 * day, null),
            message("recent-1", now - 2000, "parent"),
            message("ancestor", now - 7 * day, "parent"),
            message("missing-parent", now - 500, "missing"),
            message("ordinary", now - 250, null),
            message("legacy", now - 100, undefined),
        ];
        backlog = backlog_fixture(records);
        context = new ChatContextBuilder(backlog, 3);
        assert.equal(backlog.ranges.length, 0);
        assert.equal(backlog.lookups.length, 0);
    }

    // 2. request a snapshot with each existing message exactly once
    {
        const times = records.map(message => message.time.getTime());
        const result = await context.get_context();
        assert.equal(result.ok, true);
        assert.deepEqual(result.value.originals.map(message => message.message_id), ["ancestor", "parent"]);
        assert.deepEqual(result.value.window.map(message => message.message_id), [
            "recent-1", "recent-2", "missing-parent", "ordinary", "legacy",
        ]);
        assert.deepEqual(backlog.lookups, [["parent", "missing"], ["ancestor"]]);
        const from = new Date(now);
        from.setUTCHours(0, 0, 0, 0);
        from.setUTCDate(from.getUTCDate() - 3);
        assert.equal(backlog.ranges[0].from.getTime(), from.getTime());
        assert.equal(backlog.ranges[0].to.getTime(), now);
        assert.deepEqual(records.map(message => message.time.getTime()), times);
    }
});

test("ChatContextBuilder refreshes edits and missing ancestors and expires unreachable chains", async () => {
    // Motivation: repeated requests on the same component must reflect storage
    // changes and the moving window without keeping stale cached messages.

    // 1. request a context whose old original has not been stored yet
    let now: number;
    let context;
    let records;
    {
        now = Date.now();
        mock.method(Date, "now", () => now);
        records = [message("reply", now - 2 * day, "original")];
        context = new ChatContextBuilder(backlog_fixture(records), 3);
        const result = await context.get_context();
        assert.equal(result.ok, true);
        assert.equal(result.value.originals.length, 0);
        assert.deepEqual(result.value.window.map(message => message.message_id), ["reply"]);
    }

    // 2. expose the newly available ancestor and edited text on the next request
    {
        records.push(message("original", now - 10 * day, null));
        records[0].text = "Edited reply";
        const result = await context.get_context();
        assert.equal(result.ok, true);
        assert.deepEqual(result.value.originals.map(message => message.message_id), ["original"]);
        assert.deepEqual(result.value.window.map(message => message.message_id), ["reply"]);
        assert.equal(result.value.window[0].text, "Edited reply");
    }

    // 3. exclude the whole chain when its only root leaves the window
    {
        now += 2 * day;
        const result = await context.get_context();
        assert.equal(result.ok, true);
        assert.deepEqual(result.value, { originals: [], window: [] });
    }
});

test("ChatContextBuilder returns storage failures and permits a fresh retry", async () => {
    // Motivation: callers must not mistake an unreadable history for an empty
    // or complete snapshot and send an LLM request with missing context.

    // 1. create a context whose window read is unavailable
    let context;
    let backlog;
    {
        const now = Date.now();
        backlog = backlog_fixture([
            message("reply", now - 1000, "parent"),
            message("parent", now - 10 * day, null),
        ]);
        context = new ChatContextBuilder(backlog, 3);
        backlog.fail_range("window unavailable");
    }

    // 2. return the window failure without attempting any ancestor reads
    {
        const result = await context.get_context();
        assert.equal(result.ok, false);
        assert.match(result.error, /window unavailable/);
        assert.equal(backlog.lookups.length, 0);
    }

    // 3. return an ancestor failure instead of a partial snapshot
    {
        backlog.fail_range(undefined);
        backlog.fail_lookup("parent unavailable");
        const result = await context.get_context();
        assert.equal(result.ok, false);
        assert.match(result.error, /parent unavailable/);
    }

    // 4. recover the full snapshot after storage becomes available
    {
        backlog.fail_lookup(undefined);
        const result = await context.get_context();
        assert.equal(result.ok, true);
        assert.deepEqual(result.value.originals.map(message => message.message_id), ["parent"]);
        assert.deepEqual(result.value.window.map(message => message.message_id), ["reply"]);
    }
});

test("ChatContextBuilder keeps its lower bound fixed within a UTC day and advances it at midnight", async () => {
    // Motivation: gradually expiring the history prefix defeats LLM cache
    // reuse; only a UTC day change should remove messages from the window.

    // 1. create a three-day context spanning the year boundary
    let now: number;
    let context;
    let backlog;
    let cutoff;
    {
        now = Date.parse("2027-01-02T00:00:00.000Z");
        mock.method(Date, "now", () => now);
        cutoff = Date.parse("2026-12-30T00:00:00.000Z");
        backlog = backlog_fixture([
            message("before-window", cutoff - 1, null),
            message("ancestor", cutoff - 10 * day, null),
            message("boundary", cutoff, "ancestor"),
            message("later-that-day", cutoff + 12 * 3600_000, null),
            message("survivor", cutoff + day, null),
            message("new-today", now + 12 * 3600_000, null),
        ]);
        context = new ChatContextBuilder(backlog, 3);
    }

    // 2. include the boundary and its chain at exactly three days of depth
    let morning;
    {
        const result = await context.get_context();
        assert.equal(result.ok, true);
        morning = result.value;
        assert.deepEqual(morning.originals.map(message => message.message_id), ["ancestor"]);
        assert.deepEqual(morning.window.map(message => message.message_id), [
            "boundary", "later-that-day", "survivor",
        ]);
        assert.equal(backlog.ranges.at(-1)!.from.getTime(), cutoff);
        assert.equal(now - cutoff, 3 * day);
    }

    // 3. append new messages while preserving the same prefix within the day
    for (const time of ["2027-01-02T12:00:00.000Z", "2027-01-02T23:59:59.999Z"]) {
        now = Date.parse(time);
        const result = await context.get_context();
        assert.equal(result.ok, true);
        assert.deepEqual(result.value.originals, morning.originals);
        assert.deepEqual(result.value.window.slice(0, morning.window.length), morning.window);
        assert.equal(result.value.window.at(-1)!.message_id, "new-today");
        assert.equal(backlog.ranges.at(-1)!.from.getTime(), cutoff);
        assert.equal(backlog.ranges.at(-1)!.to.getTime(), now);
        assert.ok(now - cutoff >= 3 * day && now - cutoff < 4 * day);
    }

    // 4. expire the first day and its unreachable ancestor at the next midnight
    {
        now = Date.parse("2027-01-03T00:00:00.000Z");
        const result = await context.get_context();
        assert.equal(result.ok, true);
        assert.equal(backlog.ranges.at(-1)!.from.getTime(), cutoff + day);
        assert.equal(result.value.originals.length, 0);
        assert.deepEqual(result.value.window.map(message => message.message_id), ["survivor", "new-today"]);
        assert.equal(now - backlog.ranges.at(-1)!.from.getTime(), 3 * day);
    }
});
