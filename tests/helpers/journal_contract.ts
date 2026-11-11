import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryJournalRecord } from "@src/components/memory_journal.js";
import { IJournal, JournalLevel } from "@src/interfaces/journal.js";
import { return_exception } from "@src/utils.js";

import { object } from "./objects.js";

type Fixture = () => { journal: IJournal; records(): readonly MemoryJournalRecord[] };

export function journal_contract(name: string, fixture: Fixture) {
    test(`${name} journal supports both call forms at every level`, () => {
        // Motivation: components must retain the same diagnostic information
        // when production and in-memory journals are interchanged.

        // 1. create a journal with all four levels enabled
        const context = fixture();
        const levels: JournalLevel[] = ["info", "error", "debug", "warning"];
        {
            assert.equal(context.records().length, 0);
        }

        // 2. emit both call forms at each level
        for (const level of levels) {
            // 2.1 emit a message without structured fields
            {
                context.journal[level](`${level} message`);
            }

            // 2.2 emit structured fields with a message
            {
                context.journal[level]({ operation: "save", attempt: 2 }, `${level} fields`);
            }
        }

        // 3. verify all records preserve their level, message, and fields
        {
            assert.deepEqual(context.records(), levels.flatMap(level => [
                { level, message: `${level} message`, component: "", fields: {} },
                { level, message: `${level} fields`, component: "",
                    fields: { operation: "save", attempt: 2 } },
            ]));
        }
    });

    test(`${name} children inherit context without changing parents or siblings`, () => {
        // Motivation: diagnostics from nested components must remain
        // attributable to their origin while scoped bindings cannot affect
        // adjacent work.

        // 1. construct a parent and two descendants with conflicting bindings
        const context = fixture();
        const parent = context.journal.child("runtime", { request: "parent", shared: 1 });
        const child = parent.child("users", { request: "child", user_id: "user" });
        const sibling = parent.child("scores");
        {
            assert.equal(context.records().length, 0);
        }

        // 2. interleave messages and override a binding for one call only
        {
            parent.info("parent");
            child.warning({ request: "call" }, "child override");
            sibling.debug("sibling");
            child.info("child");
            context.journal.error("root");
        }

        // 3. verify shared ordering and independent context at every scope
        {
            assert.deepEqual(context.records(), [
                { level: "info", message: "parent", component: "runtime",
                    fields: { request: "parent", shared: 1 } },
                { level: "warning", message: "child override", component: "runtime.users",
                    fields: { request: "call", shared: 1, user_id: "user" } },
                { level: "debug", message: "sibling", component: "runtime.scores",
                    fields: { request: "parent", shared: 1 } },
                { level: "info", message: "child", component: "runtime.users",
                    fields: { request: "child", shared: 1, user_id: "user" } },
                { level: "error", message: "root", component: "", fields: {} },
            ]);
        }
    });

    test(`${name} journal preserves exceptions reported by application helpers`, () => {
        // Motivation: removing access to the backend logger must retain useful
        // error details and the helper's existing failure result.

        // 1. create a journal and an exception to report
        const context = fixture();
        const error = new Error("storage unavailable");
        {
            assert.equal(context.records().length, 0);
        }

        // 2. report an exception and a primitive failure through the helper
        {
            const result = return_exception(error, context.journal, "could not save");
            assert.equal(result.ok, false);
            assert.match(result.error, /could not save/);
            assert.equal(return_exception("offline", context.journal).error, "offline");
        }

        // 3. verify exception details and primitive values reach the journal
        {
            const records = context.records();
            assert.equal(records.length, 2);
            assert.equal(records[0].message, error.message);
            assert.equal(object(records[0].fields.error).message, error.message);
            assert.equal(object(records[0].fields.error).stack, error.stack);
            assert.equal(records[1].message, "offline");
            assert.equal(records[1].fields.error, "offline");
        }
    });
}
