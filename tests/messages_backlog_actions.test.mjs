import { MemoryJournal } from "../dist/components/memory_journal.js";
import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

import { Runtime } from "../dist/runtime.js";
import { AnnouncesChat } from "../dist/use_cases/announces_chat.js";
import { ManagersChat } from "../dist/use_cases/managers_chat.js";
import { Expected } from "../dist/utils/expected.js";

afterEach(() => mock.restoreAll());

test("incoming messages are saved before notifying the agent and edits only update storage", async () => {
    // Motivation: removing the chat queue must preserve persistence before
    // notification, while edits and announcements must not trigger the agent.

    // 1. provide direct backlogs and delay the first message write
    const attempts = [];
    const notifications = [];
    const message = { message_id: "message", time: new Date(),
        sender_id: "author", text: "@bot Question", reply_to: null };
    const journal = new MemoryJournal();
    let release_write;
    let started;
    {
        let mark_started;
        started = new Promise(resolve => { mark_started = resolve; });
        const pending_write = new Promise(resolve => { release_write = resolve; });
        const backlog = {
            async add_message(saved) {
                assert.strictEqual(saved, message);
                attempts.push("add:start");
                mark_started();
                await pending_write;
                attempts.push("add:done");
                return Expected.ok(undefined);
            },
            async update_message(saved) {
                attempts.push(`update:${saved.text}`);
                return Expected.ok(undefined);
            },
        };
        mock.method(Runtime, "get_instance", () => ({
            get_managers_backlog: () => backlog,
            get_managers_agent: () => ({ on_new_message: saved => {
                attempts.push("notify");
                notifications.push(saved);
            } }),
            get_announce_backlog: () => ({ async add_message(saved) {
                assert.strictEqual(saved, message);
                attempts.push("announce");
                return Expected.ok(undefined);
            } }),
        }));
    }

    // 2. keep the notification pending until the original write finishes
    let processing;
    {
        processing = ManagersChat.on_new_message(message, journal);
        await started;
        assert.deepEqual(attempts, ["add:start"]);
        assert.deepEqual(notifications, []);
        release_write();
        assert.equal((await processing).ok, true);
        assert.deepEqual(attempts, ["add:start", "add:done", "notify"]);
        assert.deepEqual(notifications, [message]);
    }

    // 3. save edits and announcements immediately without notifying the agent
    {
        assert.equal((await ManagersChat.on_message_edited({ ...message, text: "Edited" }, journal)).ok, true);
        assert.equal((await AnnouncesChat.on_new_message(message, journal)).ok, true);
        assert.deepEqual(attempts, ["add:start", "add:done", "notify", "update:Edited", "announce"]);
        assert.deepEqual(notifications, [message]);
        assert.deepEqual(journal.records, []);
    }
});

for (const failure of ["error", "throw", "missing"]) {
    test(`direct message writes remain best effort when storage fails: ${failure}`, async () => {
        // Motivation: persistence failures must be logged without cancelling
        // agent notification, edit handling, or announcement processing.

        // 1. provide failing or absent backlogs and observe agent notifications
        const attempts = [];
        const notifications = [];
        const message = { message_id: "message", time: new Date(),
            sender_id: "author", text: "@bot Question" };
        const journal = new MemoryJournal();
        {
            const save = async operation => {
                attempts.push(operation);
                if (failure === "throw") {
                    throw new Error("Storage exception");
                }
                return Expected.err("Storage error");
            };
            const backlog = failure === "missing" ? undefined : {
                add_message: () => save("add"),
                update_message: () => save("update"),
            };
            mock.method(Runtime, "get_instance", () => ({
                get_managers_backlog: () => backlog,
                get_announce_backlog: () => backlog,
                get_managers_agent: () => ({ on_new_message: saved => notifications.push(saved) }),
            }));
        }

        // 2. attempt each operation once and continue despite every failure
        {
            assert.equal((await ManagersChat.on_new_message(message, journal)).ok, true);
            assert.equal((await ManagersChat.on_message_edited(message, journal)).ok, true);
            assert.equal((await AnnouncesChat.on_new_message(message, journal)).ok, true);
            assert.deepEqual(attempts, failure === "missing" ? [] : ["add", "update", "add"]);
            assert.deepEqual(notifications, [message]);
            assert.equal(journal.records.filter(record => record.level === "error").length, 3);
        }
    });
}
