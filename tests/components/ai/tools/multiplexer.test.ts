import assert from "node:assert/strict";
import { test } from "node:test";

import { ToolsMultiplexer } from "@src/components/ai/tools/multiplexer.js";
import { MemoryJournal } from "@src/components/memory_journal.js";
import { Expected, Status } from "@src/utils/expected.js";

import { recording_toolchain as toolchain } from "@tests/mocks/toolchain.js";

const journal = new MemoryJournal();


test("registrations check their own permissions on every invocation", async () => {
    // Motivation: access conditions belong to each registered toolchain;
    // denying one must not affect another or a registration without a check.

    // 1. register two independent checks and an unrestricted toolchain
    let mux;
    let allowed = false;
    const calls: string[] = [];
    const checks: string[] = [];
    {
        mux = new ToolsMultiplexer(journal);
        assert.equal(mux.add_tool(toolchain("first", calls, ["first_read", "first_write"]), () => {
            checks.push("first");
            return allowed ? Expected.ok(undefined) : Expected.err("first denied");
        }).ok, true);
        assert.equal(mux.add_tool(toolchain("second", calls), () => {
            checks.push("second");
            return Expected.ok(undefined);
        }).ok, true);
        assert.equal(mux.add_tool(toolchain("open", calls)).ok, true);
    }

    // 2. deny both functions from the first registration and allow the others
    {
        assert.equal((await mux.call_tool("first_read", {})).error, "first denied");
        assert.equal((await mux.call_tool("first_write", {})).error, "first denied");
        assert.equal((await mux.call_tool("second_call", {})).ok, true);
        assert.equal((await mux.call_tool("open_call", {})).ok, true);
        assert.deepEqual(calls, ["second_call", "open_call"]);
        assert.deepEqual(checks, ["first", "first", "second"]);
    }

    // 3. grant access and retry both functions without registering them again
    {
        allowed = true;
        assert.equal((await mux.call_tool("first_read", {})).ok, true);
        assert.equal((await mux.call_tool("first_write", {})).ok, true);
        assert.deepEqual(calls, ["second_call", "open_call", "first_read", "first_write"]);
        assert.deepEqual(checks, ["first", "first", "second", "first", "first"]);
    }

    // 4. ignore unknown functions without running another registration's check
    {
        assert.equal((await mux.call_tool("unknown", {})).ok, false);
        assert.equal(checks.length, 5);
    }
});

for (const failure of ["denied", "exception", "rejection"]) {
    test(`a tool access callback fails closed on ${failure}`, async () => {
        // Motivation: policy failures must stop execution at the multiplexer
        // even when the callback throws or its asynchronous check rejects.

        // 1. register a toolchain with the selected failing access callback
        let mux;
        const calls: string[] = [];
        {
            mux = new ToolsMultiplexer(journal);
            assert.equal(mux.add_tool(toolchain("protected", calls), () => {
                if (failure === "denied") {
                    return Expected.err("access denied").set_error_code(42);
                }
                if (failure === "exception") {
                    throw new Error("policy unavailable");
                }
                return Promise.reject(new Error("policy unavailable"));
            }).ok, true);
        }

        // 2. call the tool and verify that no handler ran
        {
            const result = await mux.call_tool("protected_call", {});
            assert.equal(result.ok, false);
            assert.equal(calls.length, 0);
            assert.match(result.error, /access denied|policy unavailable/);
            assert.equal(result.is_error(42), failure === "denied");
        }
    });
}

test("an asynchronous access callback completes before the handler runs", async () => {
    // Motivation: a pending permission lookup must not let a registered action
    // execute early, and successful completion must permit the original call.

    // 1. register a tool with a manually controlled permission lookup
    let mux;
    let resolve_access!: (status: Status) => void;
    let started;
    const calls: string[] = [];
    {
        mux = new ToolsMultiplexer(journal);
        let notify_started!: () => void;
        started = new Promise<void>(resolve => { notify_started = resolve; });
        const access = new Promise<Status>(resolve => { resolve_access = resolve; });
        assert.equal(mux.add_tool(toolchain("protected", calls), async () => {
            notify_started();
            return await access;
        }).ok, true);
    }

    // 2. start a tool invocation and verify it waits for permission
    let pending;
    {
        pending = mux.call_tool("protected_call", {});
        await started;
        assert.equal(calls.length, 0);
    }

    // 3. allow execution and verify the handler runs exactly once
    {
        resolve_access(Expected.ok(undefined));
        assert.equal((await pending).ok, true);
        assert.deepEqual(calls, ["protected_call"]);
    }
});

test("removing and registering a tool again replaces its access callback", async () => {
    // Motivation: a removed registration must not leave a stale permission
    // callback attached to a later toolchain with the same function names.

    // 1. register a toolchain with denied access and retain its advertised tools
    let mux;
    let original;
    let advertised;
    let checks = 0;
    const calls: string[] = [];
    {
        mux = new ToolsMultiplexer(journal);
        original = toolchain("shared", calls);
        assert.equal(mux.add_tool(original, () => {
            checks += 1;
            return Expected.err("old policy");
        }).ok, true);
        advertised = mux.get_tools();
        assert.equal((await mux.call_tool("shared_call", {})).ok, false);
    }

    // 2. remove the registration and deny a saved function name
    {
        assert.equal(mux.remove_tool(original).ok, true);
        assert.equal(mux.get_tools().has("shared_call"), false);
        assert.equal((await mux.call_tool("shared_call", {})).ok, false);
        assert.equal(checks, 1);
    }

    // 3. register a replacement without a check and verify it executes
    {
        assert.equal(mux.add_tool(toolchain("shared", calls)).ok, true);
        assert.notStrictEqual(mux.get_tools(), advertised);
        assert.equal((await mux.call_tool("shared_call", {})).ok, true);
        assert.equal(checks, 1);
        assert.deepEqual(calls, ["shared_call"]);
    }
});

test("a registration replaced during its access check cannot execute", async () => {
    // Motivation: asynchronous checks can outlive deregistration, so an old
    // invocation must not execute a detached handler or bypass a new policy.

    // 1. register an original handler with a pending access check
    let mux;
    let original;
    let resolve_access!: (status: Status) => void;
    let started;
    const old_calls: string[] = [];
    const new_calls: string[] = [];
    {
        mux = new ToolsMultiplexer(journal);
        original = toolchain("shared", old_calls);
        let notify_started!: () => void;
        started = new Promise<void>(resolve => { notify_started = resolve; });
        const access = new Promise<Status>(resolve => { resolve_access = resolve; });
        assert.equal(mux.add_tool(original, async () => {
            notify_started();
            return await access;
        }).ok, true);
    }

    // 2. begin the old call and replace its registration while access is pending
    let pending;
    {
        pending = mux.call_tool("shared_call", {});
        await started;
        assert.equal(mux.remove_tool(original).ok, true);
        assert.equal(mux.add_tool(toolchain("shared", new_calls), () =>
            Expected.err("replacement denied")).ok, true);
    }

    // 3. allow the old check and verify neither handler can bypass replacement
    {
        resolve_access(Expected.ok(undefined));
        assert.equal((await pending).ok, false);
        assert.equal((await mux.call_tool("shared_call", {})).error, "replacement denied");
        assert.equal(old_calls.length, 0);
        assert.equal(new_calls.length, 0);
    }
});
