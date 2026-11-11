import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { LocalBroadcaster } from "@src/adapters/local_message_queue/local_broadcaster.js";
import { MemoryJournal } from "@src/components/memory_journal.js";
import { UserService } from "@src/components/user_service.js";
import { Database } from "@src/database.js";
import { UserData } from "@src/entities/user.js";
import { DepositEvent } from "@src/interfaces/deposit_service.js";
import { UserPatch } from "@src/interfaces/user_service.js";
import { Logic } from "@src/logic/abstracts.js";
import { DepositEventsHandler } from "@src/logic/deposit_events_handler.js";
import { Runtime } from "@src/runtime.js";
import { Expected } from "@src/utils/expected.js";

import { bot_config } from "@tests/helpers/config.js";
import { object } from "@tests/helpers/objects.js";
import { mock_collection } from "@tests/mocks/collection.js";
import { mock_managers_agent } from "@tests/mocks/managers_agent.js";

test("managers agent runs independently and keeps processing after failures", { timeout: 3000 }, async t => {
    // Motivation: slow model responses must leave the main runtime responsive,
    // and transient agent failures must not terminate its background loop.

    // 1. load a runtime with a slow agent and observable main-loop services
    let runtime;
    let release_response!: () => void;
    let recovered;
    let mark_recovered!: () => void;
    let agent_calls = 0;
    let active_calls = 0;
    let max_active_calls = 0;
    let main_calls = 0;
    let event_calls = 0;
    const journal = new MemoryJournal();
    {
        const response = new Promise<void>(resolve => { release_response = resolve; });
        recovered = new Promise<void>(resolve => { mark_recovered = resolve; });
        const users = new UserService(mock_collection<UserData, UserPatch>({
            async proceed() { main_calls += 1; },
        }), journal);
        const loaded = Runtime.Load(bot_config({
            runtime_cache_filename: `/tmp/choirmanager-no-cache-${randomUUID()}`,
        }), new Database(), users, journal);
        assert.equal(loaded.ok, true);
        runtime = loaded.value;
        journal.clear();
        runtime["managers_agent"] = mock_managers_agent({
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
        });
        const events = new DepositEventsHandler(new LocalBroadcaster<DepositEvent>(), journal);
        events.proceed = async () => { event_calls += 1; return Expected.ok(undefined); };
        runtime["deposit_events_handler"] = events;
        t.after(async () => {
            release_response();
            await runtime["managers_agent_proceeder"]?.stop();
        });
    }

    // 2. complete repeated runtime ticks while the first response is pending
    let proceeder;
    {
        assert.equal((await runtime.proceed(new Date())).ok, true);
        proceeder = runtime["managers_agent_proceeder"];
        assert.ok(proceeder);
        assert.ok(proceeder["logic"] instanceof Logic);
        assert.equal((await runtime.proceed(new Date())).ok, true);
        assert.equal(main_calls, 2);
        assert.equal(event_calls, 2);
        assert.equal(runtime["managers_agent_proceeder"], proceeder);
        await new Promise<void>(resolve => setTimeout(resolve, 80));
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
        assert.match(String(object(errors[1].fields.error).message), /Temporary model exception/);
        await proceeder.stop();
        assert.equal(active_calls, 0);
    }
});
