import { MemoryJournal } from "../dist/components/memory_journal.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { Runtime } from "../dist/runtime.js";
import { Logic } from "../dist/logic/abstracts.js";
import { Expected } from "../dist/utils/expected.js";

test("managers agent runs independently and keeps processing after failures", { timeout: 3000 }, async t => {
    // Motivation: slow model responses must leave the main runtime responsive,
    // and transient agent failures must not terminate its background loop.

    // 1. load a runtime with a slow agent and observable main-loop services
    let runtime;
    let release_response;
    let recovered;
    let mark_recovered;
    let agent_calls = 0;
    let active_calls = 0;
    let max_active_calls = 0;
    let main_calls = 0;
    let event_calls = 0;
    const journal = new MemoryJournal();
    {
        const response = new Promise(resolve => { release_response = resolve; });
        recovered = new Promise(resolve => { mark_recovered = resolve; });
        const loaded = Runtime.Load({ runtime: {
            runtime_cache_filename: `/tmp/choirmanager-no-cache-${randomUUID()}`,
        } }, {}, {
            async proceed() {
                main_calls += 1;
                return Expected.ok([]);
            },
        }, journal);
        assert.equal(loaded.ok, true);
        runtime = loaded.value;
        journal.clear();
        runtime.managers_agent = {
            async proceed() {
                agent_calls += 1;
                active_calls += 1;
                max_active_calls = Math.max(max_active_calls, active_calls);
                try {
                    if (agent_calls === 1) {
                        await response;
                    } else if (agent_calls === 2) {
                        return Expected.err("Temporary context read failure");
                    } else if (agent_calls === 3) {
                        throw new Error("Temporary model exception");
                    } else {
                        mark_recovered();
                    }
                    return Expected.ok(undefined);
                } finally {
                    active_calls -= 1;
                }
            },
        };
        runtime.deposit_events_handler = {
            async proceed() {
                event_calls += 1;
                return Expected.ok([]);
            },
        };
        t.after(async () => {
            release_response();
            await runtime.managers_agent_proceeder?.stop();
        });
    }

    // 2. complete repeated runtime ticks while the first response is pending
    let proceeder;
    {
        assert.equal((await runtime.proceed(new Date())).ok, true);
        proceeder = runtime.managers_agent_proceeder;
        assert.ok(proceeder);
        assert.ok(proceeder.logic instanceof Logic);
        assert.equal((await runtime.proceed(new Date())).ok, true);
        assert.equal(main_calls, 2);
        assert.equal(event_calls, 2);
        assert.equal(runtime.managers_agent_proceeder, proceeder);
        await new Promise(resolve => setTimeout(resolve, 80));
        assert.equal(agent_calls, 1);
        assert.equal(active_calls, 1);
    }

    // 3. resume the agent and recover from both status errors and exceptions
    {
        release_response();
        await recovered;
        assert.equal(max_active_calls, 1);
        const errors = journal.records.filter(record => record.level === "error");
        assert.equal(errors.length, 2);
        assert.match(errors[0].message, /Temporary context read failure/);
        assert.match(errors[1].fields.error.message, /Temporary model exception/);
        await proceeder.stop();
        assert.equal(active_calls, 0);
    }
});
