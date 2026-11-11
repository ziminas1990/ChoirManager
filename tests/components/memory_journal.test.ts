import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryJournal } from "@src/components/memory_journal.js";

import { journal_contract } from "@tests/helpers/journal_contract.js";
import { object } from "@tests/helpers/objects.js";

function memory_fixture() {
    const journal = new MemoryJournal();
    return { journal, records: () => journal.records };
}

journal_contract("memory", memory_fixture);

test("memory history survives mutations of inputs and inspected records", () => {
    // Motivation: assertions must observe the facts recorded at call time,
    // rather than objects later changed by the component or another assertion.

    // 1. record mutable bindings and data with shared and circular references
    const journal = new MemoryJournal();
    const binding = { ids: ["original"] };
    const child = journal.child("worker", { binding });
    const details: { value: string; self?: unknown } = { value: "before" };
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
        Reflect.set(records[0], "message", "changed");
        const binding_snapshot = object(records[0].fields.binding);
        assert.ok(Array.isArray(binding_snapshot.ids));
        binding_snapshot.ids.push("inspection");
        object(records[0].fields.details).value = "inspection";
        const date_snapshot = records[0].fields.date;
        assert.ok(date_snapshot instanceof Date);
        date_snapshot.setUTCFullYear(2040);
        const map_snapshot = records[0].fields.map;
        assert.ok(map_snapshot instanceof Map);
        map_snapshot.clear();
        const set_snapshot = records[0].fields.set;
        assert.ok(set_snapshot instanceof Set);
        set_snapshot.clear();
        object(records[0].fields.error).message = "inspection";
        Reflect.set(records, "length", 0);
    }

    // 3. verify stored facts and circular references remain intact
    {
        const records = journal.records;
        assert.equal(records.length, 1);
        assert.equal(records[0].message, "snapshot");
        const fields = records[0].fields;
        assert.deepEqual(fields.binding, { ids: ["original"] });
        assert.equal(object(fields.details).value, "before");
        assert.strictEqual(object(fields.details).self, fields.details);
        assert.equal((fields.date instanceof Date ? fields.date.toISOString() : undefined), "2026-11-11T00:00:00.000Z");
        assert.strictEqual((fields.map instanceof Map ? fields.map.get("key") : undefined), fields.details);
        assert.equal((fields.set instanceof Set && fields.set.has(fields.details)), true);
        assert.equal(object(fields.error).message, "before");
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
        assert.equal(journal.records.length, 0);
        child.debug("after setup");
    }

    // 3. verify the histories remain independent and child recording continues
    {
        assert.deepEqual(journal.records.map(record => record.message), ["after setup"]);
        assert.equal(journal.records[0].component, "child");
        assert.deepEqual(other.records.map(record => record.message), ["unrelated"]);
    }
});
