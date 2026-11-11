import assert from "node:assert/strict";
import { test } from "node:test";

import { PinoJournal } from "@src/adapters/journal/pino_journal.js";
import { MemoryJournalRecord } from "@src/components/memory_journal.js";

import { journal_contract } from "@tests/helpers/journal_contract.js";
import { object } from "@tests/helpers/objects.js";

function pino_fixture() {
    const lines: string[] = [];
    const journal = PinoJournal.create({ level: "debug",
        destination: { write: line => lines.push(line) } });
    return { journal, records: (): MemoryJournalRecord[] => lines.map(line => {
        const { level, msg, component, time, ...fields } = object(JSON.parse(line));
        assert.equal(typeof time, "number");
        assert.ok(typeof level === "string");
        const normalized = level === "WARN" ? "warning" : level.toLowerCase();
        assert.ok(normalized === "info" || normalized === "error" || normalized === "debug" || normalized === "warning");
        assert.ok(typeof msg === "string" && typeof component === "string");
        return { level: normalized,
            message: msg, component, fields };
    }) };
}

journal_contract("pino", pino_fixture);

test("pino keeps production level filtering and maps warning to WARN", () => {
    // Motivation: introducing a portable warning method must preserve existing
    // production verbosity and the uppercase structured level convention.

    // 1. create a production journal with its default level
    const lines: string[] = [];
    const journal = PinoJournal.create({ destination: { write: line => lines.push(line) } });
    {
        assert.equal(lines.length, 0);
    }

    // 2. emit debug, info, and warning diagnostics
    {
        journal.debug("hidden");
        journal.info("visible");
        journal.warning("warning");
    }

    // 3. verify debug is filtered and output retains the production schema
    {
        const records = lines.map(line => object(JSON.parse(line)));
        assert.deepEqual(records.map(record => record.level), ["INFO", "WARN"]);
        assert.deepEqual(records.map(record => record.msg), ["visible", "warning"]);
        assert.ok(records.every(record => record.component === ""));
    }
});
