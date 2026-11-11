import assert from "node:assert/strict";
import { test } from "node:test";

import { PinoJournal } from "../dist/adapters/journal/pino_journal.js";
import { MemoryJournal } from "../dist/components/memory_journal.js";
import { return_exception } from "../dist/utils.js";

function memory_fixture() {
    const journal = new MemoryJournal();
    return { journal, records: () => journal.records };
}

function pino_fixture() {
    const lines = [];
    const journal = PinoJournal.create({ level: "debug",
        destination: { write: line => lines.push(line) } });
    return { journal, records: () => lines.map(line => {
        const { level, msg, component, time, ...fields } = JSON.parse(line);
        assert.equal(typeof time, "number");
        return { level: level === "WARN" ? "warning" : level.toLowerCase(),
            message: msg, component, fields };
    }) };
}

for (const [name, fixture] of [["memory", memory_fixture], ["pino", pino_fixture]]) {
    test(`${name} journal supports both call forms at every level`, () => {
        // Motivation: components must retain the same diagnostic information
        // when production and in-memory journals are interchanged.

        // 1. create a journal with all four levels enabled
        const context = fixture();
        const levels = ["info", "error", "debug", "warning"];
        {
            assert.deepEqual(context.records(), []);
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
        // Motivation: diagnostics from nested components must remain attributable
        // to their origin while scoped bindings cannot affect adjacent work.

        // 1. construct a parent and two descendants with conflicting bindings
        const context = fixture();
        const parent = context.journal.child("runtime", { request: "parent", shared: 1 });
        const child = parent.child("users", { request: "child", user_id: "user" });
        const sibling = parent.child("scores");
        {
            assert.deepEqual(context.records(), []);
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
            assert.deepEqual(context.records(), []);
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
            assert.equal(records[0].fields.error.message, error.message);
            assert.equal(records[0].fields.error.stack, error.stack);
            assert.equal(records[1].message, "offline");
            assert.equal(records[1].fields.error, "offline");
        }
    });
}

test("memory history survives mutations of inputs and inspected records", () => {
    // Motivation: assertions must observe the facts recorded at call time,
    // rather than objects later changed by the component or another assertion.

    // 1. record mutable bindings and data with shared and circular references
    const journal = new MemoryJournal();
    const binding = { ids: ["original"] };
    const child = journal.child("worker", { binding });
    const details = { value: "before" };
    const date = new Date("2026-11-11T00:00:00Z");
    const map = new Map([["key", details]]);
    const set = new Set([details]);
    const error = new Error("before");
    {
        details.self = details;
        child.debug({ details, date, map, set, error }, "snapshot");
    }

    // 2. mutate the caller's objects and a returned history snapshot
    {
        binding.ids.push("changed");
        details.value = "after";
        date.setUTCFullYear(2030);
        map.clear();
        set.clear();
        error.message = "after";
        const records = journal.records;
        records[0].message = "changed";
        records[0].fields.binding.ids.push("inspection");
        records[0].fields.details.value = "inspection";
        records[0].fields.date.setUTCFullYear(2040);
        records[0].fields.map.clear();
        records[0].fields.set.clear();
        records[0].fields.error.message = "inspection";
        records.length = 0;
    }

    // 3. verify stored facts and circular references remain intact
    {
        const records = journal.records;
        assert.equal(records.length, 1);
        assert.equal(records[0].message, "snapshot");
        const fields = records[0].fields;
        assert.deepEqual(fields.binding, { ids: ["original"] });
        assert.equal(fields.details.value, "before");
        assert.strictEqual(fields.details.self, fields.details);
        assert.equal(fields.date.toISOString(), "2026-11-11T00:00:00.000Z");
        assert.strictEqual(fields.map.get("key"), fields.details);
        assert.equal(fields.set.has(fields.details), true);
        assert.equal(fields.error.message, "before");
    }
});

test("independent memory roots remain isolated when shared child history is cleared", () => {
    // Motivation: a fixture must be able to discard setup diagnostics without
    // losing child wiring or changing a separate test's journal.

    // 1. create independent roots and record a child message
    const journal = new MemoryJournal();
    const other = new MemoryJournal();
    const child = journal.child("child");
    {
        child.info("setup");
        other.info("unrelated");
    }

    // 2. clear the first root and continue using its existing child
    {
        journal.clear();
        assert.deepEqual(journal.records, []);
        child.debug("after setup");
    }

    // 3. verify the histories remain independent and child recording continues
    {
        assert.deepEqual(journal.records.map(record => record.message), ["after setup"]);
        assert.equal(journal.records[0].component, "child");
        assert.deepEqual(other.records.map(record => record.message), ["unrelated"]);
    }
});

test("pino keeps production level filtering and maps warning to WARN", () => {
    // Motivation: introducing a portable warning method must preserve existing
    // production verbosity and the uppercase structured level convention.

    // 1. create a production journal with its default level
    const lines = [];
    const journal = PinoJournal.create({ destination: { write: line => lines.push(line) } });
    {
        assert.deepEqual(lines, []);
    }

    // 2. emit debug, info, and warning diagnostics
    {
        journal.debug("hidden");
        journal.info("visible");
        journal.warning("warning");
    }

    // 3. verify debug is filtered and output retains the production schema
    {
        const records = lines.map(line => JSON.parse(line));
        assert.deepEqual(records.map(record => record.level), ["INFO", "WARN"]);
        assert.deepEqual(records.map(record => record.msg), ["visible", "warning"]);
        assert.ok(records.every(record => record.component === ""));
    }
});
