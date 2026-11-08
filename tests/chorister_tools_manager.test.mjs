import assert from "node:assert/strict";
import { test } from "node:test";

import { ChoristerToolsManager } from "../dist/components/ai/chorister_tools_manager.js";
import { Role } from "../dist/entities/user.js";
import { Expected } from "../dist/utils/expected.js";

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const journal = { child() { return this; }, log() { return logger; } };
const user = { userid: () => "member-id" };
const dependencies = {
    send_message: async () => Expected.ok(undefined),
    start_feedback: async () => Expected.ok(undefined),
};

test("one toolchain reflects role grants and revocations while retaining base tools", async () => {
    // Motivation: an existing assistant must gain and lose role permissions
    // without replacing its toolchain or disturbing unrelated capabilities.

    // 1. create a manager with only the chorister's base capabilities
    let manager;
    let toolchain;
    let base_tools;
    {
        const created = ChoristerToolsManager.create(user, [Role.Chorister], journal,
            dependencies, { task_tracker: {}, simple_memory: {}, users: {}, administration: {} });
        assert.equal(created.ok, true, created.ok ? undefined : created.error);
        manager = created.value;
        toolchain = manager.get_toolchain();
        base_tools = [...toolchain.get_tools().keys()].sort();
        assert.ok(base_tools.length > 0);
        assert.equal(toolchain.get_tools().has("get_opened_tasks"), false);
        assert.equal(toolchain.get_tools().has("ask"), false);
        assert.equal(toolchain.get_tools().has("users_find"), false);
    }

    // 2. grant manager capabilities on the existing toolchain
    let manager_tools;
    {
        assert.equal(manager.update_roles([Role.Chorister, Role.Manager]).ok, true);
        assert.strictEqual(manager.get_toolchain(), toolchain);
        manager_tools = toolchain.get_tools();
        assert.equal(manager_tools.has("get_opened_tasks"), true);
        assert.equal(manager_tools.has("ask"), true);
        assert.equal(manager_tools.has("users_find"), false);
    }

    // 3. keep the registered tools unchanged for reordered or duplicate roles
    {
        assert.equal(manager.update_roles([Role.Manager, Role.Chorister, Role.Manager]).ok, true);
        assert.strictEqual(toolchain.get_tools(), manager_tools);
    }

    // 4. grant administration while preserving manager capabilities
    {
        assert.equal(manager.update_roles([Role.Manager, Role.Admin]).ok, true);
        assert.equal(toolchain.get_tools().has("get_opened_tasks"), true);
        assert.equal(toolchain.get_tools().has("ask"), true);
        assert.equal(toolchain.get_tools().has("users_find"), true);
    }

    // 5. revoke manager tools and reject calls through the retained toolchain
    {
        assert.equal(manager.update_roles([Role.Admin]).ok, true);
        assert.equal(toolchain.get_tools().has("get_opened_tasks"), false);
        assert.equal(toolchain.get_tools().has("ask"), false);
        assert.equal(toolchain.get_tools().has("users_find"), true);
        assert.equal((await toolchain.call_tool("get_opened_tasks", {})).ok, false);
        assert.equal((await toolchain.call_tool("ask", { question: "Rehearsal?" })).ok, false);
    }

    // 6. regrant manager access without replacing the exposed toolchain
    {
        assert.equal(manager.update_roles([Role.Manager, Role.Admin]).ok, true);
        assert.strictEqual(manager.get_toolchain(), toolchain);
        assert.equal(toolchain.get_tools().has("get_opened_tasks"), true);
        assert.equal(toolchain.get_tools().has("ask"), true);
        assert.equal(toolchain.get_tools().has("users_find"), true);
    }

    // 7. revoke all roles while keeping the base capabilities
    {
        assert.equal(manager.update_roles([]).ok, true);
        assert.deepEqual([...toolchain.get_tools().keys()].sort(), base_tools);
        assert.equal((await toolchain.call_tool("users_find", {})).ok, false);
    }
});

test("role tools require their services as well as the matching role", () => {
    // Motivation: optional services must remain optional when privileged
    // roles are granted, and unavailable capabilities must stay hidden.

    // 1. provide the task tracker without memory, administration, or users
    let manager;
    {
        const created = ChoristerToolsManager.create(user, [Role.Manager, Role.Admin],
            journal, dependencies, { task_tracker: {} });
        assert.equal(created.ok, true, created.ok ? undefined : created.error);
        manager = created.value;
    }

    // 2. expose only the available role capabilities
    {
        const tools = manager.get_toolchain().get_tools();
        assert.equal(tools.has("get_opened_tasks"), true);
        assert.equal(tools.has("ask"), false);
        assert.equal(tools.has("users_find"), false);
    }
});
