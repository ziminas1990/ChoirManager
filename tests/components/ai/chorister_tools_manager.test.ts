import assert from "node:assert/strict";
import { test } from "node:test";

import { Agent } from "@src/components/ai/agent.js";
import { ChoristerToolsManager, ChoristerToolsServices } from "@src/components/ai/chorister_tools_manager.js";
import { MemoryJournal } from "@src/components/memory_journal.js";
import { Language, Role, UserData, UserId, Voice } from "@src/entities/user.js";
import { Message, Response } from "@src/interfaces/llm.js";
import { Expected } from "@src/utils/expected.js";

import { reply } from "@tests/helpers/llm.js";
import { mock_administration } from "@tests/mocks/administration.js";
import { mock_llm } from "@tests/mocks/llm.js";
import { mock_simple_memory } from "@tests/mocks/simple_memory.js";
import { mock_task_tracker } from "@tests/mocks/task_tracker.js";
import { mock_user_agent } from "@tests/mocks/user_agent.js";
import { mock_user_replica } from "@tests/mocks/user_replica.js";

const journal = new MemoryJournal();
const user = mock_user_agent({ userid: () => "member-id" });
const dependencies = {
    send_message: async () => Expected.ok(undefined),
    start_feedback: async () => Expected.ok(undefined),
};

function fixture(roles = [Role.Chorister, Role.Manager, Role.Admin]) {
    const state: { profile: UserData; checks: Partial<UserId>[]; calls: string[] } = {
        profile: {
            id: { system_id: user.userid(), tg_username: "member" },
            name: "Member", surname: "Singer", lang: Language.EN,
            voice: Voice.Alto, roles: [...roles],
        },
        checks: [],
        calls: [],
    };
    const services: ChoristerToolsServices = {
        users: mock_user_replica({
            resolve_user(id) {
                state.checks.push(id);
                return Expected.ok(state.profile);
            },
            find() {
                state.calls.push("users_find");
                return [state.profile];
            },
        }),
        task_tracker: mock_task_tracker({
            async fetch() {
                state.calls.push("get_opened_tasks");
                return Expected.ok([]);
            },
        }),
        simple_memory: mock_simple_memory({}),
        administration: mock_administration({}),
    };
    const created = ChoristerToolsManager.create(user, roles, journal, {
        async send_message() {
            state.calls.push("messenger_send_message");
            return Expected.ok(undefined);
        },
        async start_feedback() {
            state.calls.push("feedback_start");
            return Expected.ok(undefined);
        },
    }, services);
    assert.equal(created.ok, true, created.ok ? undefined : created.error);
    return { state, services, manager: created.value, toolchain: created.value.get_toolchain() };
}

test("one toolchain reflects role grants and revocations while retaining base tools", async () => {
    // Motivation: an existing assistant must gain and lose role permissions
    // without replacing its toolchain or disturbing unrelated capabilities.

    // 1. create a manager with only the chorister's base capabilities
    let manager;
    let toolchain;
    let base_tools;
    let roles = [Role.Chorister];
    {
        const users = mock_user_replica({ resolve_user: () => Expected.ok({ ...fixture_profile(), roles }) });
        const created = ChoristerToolsManager.create(user, roles, journal,
            dependencies, { task_tracker: mock_task_tracker({}), simple_memory: mock_simple_memory({}), users, administration: mock_administration({}) });
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
        roles = [Role.Admin];
        assert.equal(manager.update_roles(roles).ok, true);
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
        roles = [];
        assert.equal(manager.update_roles(roles).ok, true);
        assert.deepEqual([...toolchain.get_tools().keys()].sort(), base_tools);
        assert.equal((await toolchain.call_tool("users_find", {})).ok, false);
    }
});

test("each invocation checks current roles without an explicit session update", async () => {
    // Motivation: an active assistant can hold stale tool schemas, so execution
    // must follow current roles while leaving unaffected capabilities usable.

    // 1. create an assistant with both administrative and manager capabilities
    let context;
    {
        context = fixture();
        assert.equal((await context.toolchain.call_tool("get_opened_tasks", {})).ok, true);
        assert.equal((await context.toolchain.call_tool("users_find", {})).ok, true);
    }

    // 2. revoke Manager in the replica and deny task and memory operations
    {
        context.state.profile = { ...context.state.profile, roles: [Role.Chorister, Role.Admin] };
        assert.equal((await context.toolchain.call_tool("get_opened_tasks", {})).ok, false);
        assert.equal((await context.toolchain.call_tool("ask", { question: "Rehearsal?" })).ok, false);
        assert.equal((await context.toolchain.call_tool("users_find", {})).ok, true);
        assert.equal(context.toolchain.get_tools().has("get_opened_tasks"), true);
        assert.equal(context.toolchain.get_tools().has("ask"), true);
        assert.deepEqual(context.state.calls, ["get_opened_tasks", "users_find", "users_find"]);
    }

    // 3. revoke Admin, regrant Manager, and retain membership capabilities
    {
        context.state.profile = { ...context.state.profile, roles: [Role.Chorister, Role.Manager] };
        assert.equal((await context.toolchain.call_tool("users_find", {})).ok, false);
        assert.equal((await context.toolchain.call_tool("get_opened_tasks", {})).ok, true);
        assert.equal((await context.toolchain.call_tool("feedback_start", {})).ok, true);
        assert.deepEqual(context.state.calls, ["get_opened_tasks", "users_find", "users_find",
            "get_opened_tasks", "feedback_start"]);
        assert.strictEqual(context.manager.get_toolchain(), context.toolchain);
        assert.deepEqual(context.state.checks, Array.from({ length: 8 }, () => ({
            system_id: user.userid(),
        })));
    }
});

test("base tool callbacks enforce their own role requirements", async () => {
    // Motivation: losing Chorister while retaining Admin must revoke scores and
    // deposit tools without blocking messaging or administrative actions.

    // 1. create an assistant and retain its original tool registrations
    let context;
    {
        context = fixture();
        context.state.profile = { ...context.state.profile, roles: [Role.Admin] };
        assert.equal(context.toolchain.get_tools().has("scores_get_list"), true);
        assert.equal(context.toolchain.get_tools().has("deposit_manager_top_up"), true);
    }

    // 2. deny scores and deposits before their domain handlers can execute
    {
        const scores = await context.toolchain.call_tool("scores_get_list", {});
        const deposit = await context.toolchain.call_tool("deposit_manager_top_up", {
            amount: 10, original_message: "I paid 10",
        });
        assert.equal(scores.ok, false);
        assert.match(scores.error, /no permission/);
        assert.equal(deposit.ok, false);
        assert.match(deposit.error, /no permission/);
        assert.equal(context.state.calls.length, 0);
    }

    // 3. retain access to tools whose individual requirements are still met
    {
        assert.equal((await context.toolchain.call_tool("users_find", {})).ok, true);
        assert.equal((await context.toolchain.call_tool("messenger_send_message", {
            html_text: "Hello",
        })).ok, true);
        assert.equal((await context.toolchain.call_tool("feedback_start", {})).ok, true);
        assert.deepEqual(context.state.calls, ["users_find", "messenger_send_message", "feedback_start"]);
    }
});

test("removal denies every previously advertised tool and addition restores current access", async () => {
    // Motivation: base capabilities can outlive membership in the tool list; no
    // saved tool name may bypass removal, and addition must restore access.

    // 1. save every tool offered to an authorized assistant
    let context;
    let advertised;
    {
        context = fixture();
        advertised = [...context.toolchain.get_tools().keys()];
        assert.ok(advertised.includes("messenger_send_message"));
        assert.ok(advertised.includes("feedback_start"));
        assert.ok(advertised.includes("scores_get_list"));
        assert.ok(advertised.includes("deposit_manager_top_up"));
    }

    // 2. revoke all roles without notifying the active assistant
    {
        context.state.profile = { ...context.state.profile, roles: [] };
    }

    // 3. reject every old function before parsing or performing its action
    for (const name of advertised) {
        const result = await context.toolchain.call_tool(name, {});
        assert.equal(result.ok, false, name);
        assert.match(result.error, /no permission/, name);
    }

    // 4. restore only membership and execute permitted actions on the same chain
    {
        assert.equal(context.state.calls.length, 0);
        context.state.profile = { ...context.state.profile, roles: [Role.Chorister] };
        assert.equal((await context.toolchain.call_tool("messenger_send_message", {
            html_text: "Welcome back",
        })).ok, true);
        assert.equal((await context.toolchain.call_tool("feedback_start", {})).ok, true);
        assert.equal((await context.toolchain.call_tool("users_find", {})).ok, false);
        assert.equal((await context.toolchain.call_tool("get_opened_tasks", {})).ok, false);
        assert.deepEqual(context.state.calls, ["messenger_send_message", "feedback_start"]);
    }
});

for (const failure of ["missing user", "lookup error", "lookup exception", "service disabled"]) {
    test(`tool execution fails closed on ${failure} and can recover`, async () => {
        // Motivation: unavailable permission data must not fall back to roles
        // cached by the assistant, while a temporary outage must allow retry.

        // 1. create an authorized assistant and retain the working user replica
        let context;
        let users;
        {
            context = fixture();
            users = context.services.users;
        }

        // 2. make the current permission lookup unavailable
        {
            context.services.users = {
                ...users!,
                resolve_user() {
                    if (failure === "missing user") {
                        return Expected.ok(undefined);
                    }
                    if (failure === "lookup error") {
                        return Expected.err("offline");
                    }
                    throw new Error("offline");
                },
            };
            if (failure === "service disabled") {
                context.services.users = undefined;
            }
        }

        // 3. deny a valid message tool call without executing its callback
        {
            const result = await context.toolchain.call_tool("messenger_send_message", {
                html_text: "Must not be sent",
            });
            assert.equal(result.ok, false);
            assert.equal(context.state.calls.length, 0);
        }

        // 4. recover the replica and allow the same action on the same assistant
        {
            context.services.users = users;
            assert.equal((await context.toolchain.call_tool("messenger_send_message", {
                html_text: "Recovered",
            })).ok, true);
            assert.deepEqual(context.state.calls, ["messenger_send_message"]);
        }
    });
}

for (const roles of [[], [Role.Chorister]]) {
    test(`an in-progress AI response respects revoked roles ${JSON.stringify(roles)} without losing history`, async () => {
        // Motivation: a model response already in flight can contain tool calls
        // authorized by old schemas; execution must still check current roles.

        // 1. create an assistant and pause its first model response
        let context;
        let agent;
        let release_response!: (result: Expected<Response>) => void;
        let requested;
        const requests: { messages: Message[]; tools: string[] }[] = [];
        {
            context = fixture();
            let notify_requested!: () => void;
            requested = new Promise<void>(resolve => { notify_requested = resolve; });
            const response = new Promise<Expected<Response>>(resolve => { release_response = resolve; });
            const llm = mock_llm({
                async generate_response(messages, options) {
                    assert.ok(options);
                    requests.push({ messages, tools: [...options.toolchain.get_tools().keys()] });
                    if (requests.length === 1) {
                        notify_requested();
                        return await response;
                    }
                    return reply([{ role: "assistant", content: "Done" }], "Done");
                },
            });
            agent = new Agent({ instruction: "Help a singer", ttl_ms: 60_000,
                inactivity_timeout_ms: 60_000, tool_calls_limit: 1, output_format: "text" },
            llm, context.toolchain, journal);
            agent.add_user_messages([{ role: "user", content: "First request" }]);
        }

        // 2. start generation and change roles while the model is still pending
        let pending;
        {
            pending = agent.generate_response();
            await requested;
            assert.ok(requests[0].tools.includes("get_opened_tasks"));
            assert.ok(requests[0].tools.includes("users_find"));
            context.state.profile = { ...context.state.profile, roles };
        }

        // 3. release old-schema calls and verify unauthorized actions never run
        {
            release_response(reply([{ role: "tool_calls", calls: [
                { tool_call_id: "tasks", name: "get_opened_tasks", parameters: {} },
                { tool_call_id: "users", name: "users_find", parameters: {} },
                { tool_call_id: "message", name: "messenger_send_message",
                    parameters: { html_text: "Hello" } },
            ] }], null));
            const result = await pending;
            assert.equal(result.ok, true, result.ok ? undefined : result.error);
            assert.deepEqual(context.state.calls, roles.length ? ["messenger_send_message"] : []);
            const results = requests[1].messages.filter(message => message.role === "tool_result");
            assert.equal(results.length, 3);
            assert.match(results[0].result, /Tool execution has failed!/);
            assert.match(results[1].result, /Tool execution has failed!/);
            assert.equal(context.state.checks.length, 3);
        }

        // 4. keep earlier messages and tool outcomes on the same agent
        {
            agent.add_user_messages([{ role: "user", content: "Second request" }]);
            assert.equal((await agent.generate_response()).ok, true);
            assert.deepEqual(requests[2].messages.filter(message => message.role === "user")
                .map(message => "content" in message ? message.content : undefined), ["First request", "Second request"]);
            assert.ok(requests[2].messages.some(message => message.role === "tool_result"
                && message.tool_call_id === "tasks"));
        }
    });
}

test("revocation during one tool call blocks the next call in the same AI response", async () => {
    // Motivation: checking only once for a batch would let subsequent tools
    // retain access after an earlier asynchronous tool observes removal.

    // 1. let a permitted task fetch revoke membership before returning
    let context;
    let agent;
    let requests = 0;
    {
        context = fixture();
        context.services.task_tracker!.fetch = async () => {
            context.state.calls.push("get_opened_tasks");
            context.state.profile = { ...context.state.profile, roles: [] };
            return Expected.ok([]);
        };
        const llm = mock_llm({
            async generate_response() {
                requests += 1;
                return requests === 1
                    ? reply([{ role: "tool_calls", calls: [
                        { tool_call_id: "tasks", name: "get_opened_tasks", parameters: {} },
                        { tool_call_id: "feedback", name: "feedback_start", parameters: {} },
                    ] }], null)
                    : reply([{ role: "assistant", content: "Done" }], "Done");
            },
        });
        agent = new Agent({ instruction: "Help a singer", ttl_ms: 60_000,
            inactivity_timeout_ms: 60_000, tool_calls_limit: 1, output_format: "text" },
        llm, context.toolchain, journal);
    }

    // 2. complete the batch and verify only the previously authorized call ran
    {
        const result = await agent.generate_response();
        assert.equal(result.ok, true, result.ok ? undefined : result.error);
        assert.deepEqual(context.state.calls, ["get_opened_tasks"]);
        assert.equal(context.state.checks.length, 2);
    }
});

test("role tools require their services as well as the matching role", () => {
    // Motivation: optional services must remain optional when privileged roles
    // are granted, and unavailable capabilities must stay hidden.

    // 1. provide the task tracker without memory, administration, or users
    let manager;
    {
        const created = ChoristerToolsManager.create(user, [Role.Manager, Role.Admin],
            journal, dependencies, { task_tracker: mock_task_tracker({}) });
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

function fixture_profile(): UserData {
    return { id: { system_id: "member-id", tg_username: "member" }, name: "Member",
        surname: "Singer", lang: Language.EN, voice: Voice.Alto, roles: [] };
}
