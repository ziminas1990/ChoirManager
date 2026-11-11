import assert from "node:assert/strict";
import { test } from "node:test";

import { Agent, AgentCfg } from "@src/components/ai/agent.js";
import { MemoryJournal } from "@src/components/memory_journal.js";
import { IToolchain, Message, Tool, ToolsOption } from "@src/interfaces/llm.js";
import { Expected } from "@src/utils/expected.js";

import { reply } from "@tests/helpers/llm.js";
import { mock_llm } from "@tests/mocks/llm.js";
import { mock_toolchain } from "@tests/mocks/toolchain.js";

const journal = new MemoryJournal();
const config: AgentCfg = {
    instruction: "Help a singer",
    ttl_ms: 60_000,
    inactivity_timeout_ms: 60_000,
    tool_calls_limit: 1,
    output_format: "text",
};

function tool(name: string): Tool {
    return { name, description: `${name} description`, parameters: { type: "object", properties: {} } };
}

test("agent reads current tools and instructions on every LLM request without losing history", async () => {
    // Motivation: a supplied toolchain may change between LLM iterations;
    // cached schemas or instructions would leave revoked capabilities visible.

    // 1. supply a toolchain whose capabilities change after executing a tool
    const executed: { name: string; parameters: Record<string, unknown> }[] = [];
    let tools = new Map([["initial", tool("initial")]]);
    let readme = "Initial tool instructions";
    let use_cases = "Initial use case";
    let toolchain: IToolchain;
    {
        toolchain = mock_toolchain({
            get_name: () => "mutable_tools",
            get_tools: () => tools,
            get_readme: () => readme,
            get_use_cases: () => use_cases,
            async call_tool(name, parameters) {
                executed.push({ name, parameters });
                tools = new Map([["replacement", tool("replacement")]]);
                readme = "Replacement tool instructions";
                use_cases = "Replacement use case";
                return Expected.ok("Tool finished");
            },
        });
    }

    // 2. create an agent that receives a tool call and then a final answer
    const requests: { context: Message[]; toolchain: IToolchain; choice?: ToolsOption["choice"]; tools: string[] }[] = [];
    let agent;
    {
        const llm = mock_llm({
            async generate_response(context, options) {
                assert.ok(options);
                requests.push({ context, toolchain: options.toolchain, choice: options.choice,
                    tools: [...options.toolchain.get_tools().keys()] });
                if (requests.length === 1) {
                    return reply([{ role: "tool_calls", calls: [{ tool_call_id: "call-1",
                        name: "initial", parameters: {} }] }], null);
                }
                return reply([{ role: "assistant", content: "Done" }], "Done");
            },
        });
        agent = new Agent(config, llm, toolchain, journal);
        agent.add_user_messages([{ role: "user", content: "First request" }]);
    }

    // 3. complete the tool round trip through the supplied chain
    {
        const result = await agent.generate_response();
        assert.equal(result.ok, true, result.ok ? undefined : result.error);
        assert.equal(result.value, "Done");
        assert.deepEqual(executed, [{ name: "initial", parameters: {} }]);
        assert.strictEqual(requests[0].toolchain, toolchain);
        assert.strictEqual(requests[1].toolchain, toolchain);
        assert.deepEqual(requests[0].tools, ["initial"]);
        assert.deepEqual(requests[1].tools, ["replacement"]);
        assert.equal(requests[1].choice, "none");
    }

    // 4. replace tool instructions in the next request while retaining results
    {
        const first = requests[0].context.filter(message => message.role === "system")
            .map(message => "content" in message ? message.content : undefined).join("\n");
        const next = requests[1].context.filter(message => message.role === "system")
            .map(message => "content" in message ? message.content : undefined).join("\n");
        assert.match(first, /Initial tool instructions/);
        assert.match(first, /Initial use case/);
        assert.match(first, /initial description/);
        assert.match(next, /Replacement tool instructions/);
        assert.match(next, /Replacement use case/);
        assert.match(next, /replacement description/);
        assert.doesNotMatch(next, /Initial tool instructions|Initial use case|initial description/);
        assert.ok(requests[1].context.some(message => message.role === "tool_result"
            && message.tool_call_id === "call-1" && message.result === "Tool finished"));
    }

    // 5. retain the conversation on the same agent for a later user message
    {
        agent.add_user_messages([{ role: "user", content: "Second request" }]);
        assert.equal((await agent.generate_response()).ok, true);
        assert.deepEqual(requests[2].context.filter(message => message.role === "user")
            .map(message => "content" in message ? message.content : undefined), ["First request", "Second request"]);
        assert.ok(requests[2].context.some(message => message.role === "assistant"
            && message.content === "Done"));
    }
});

test("agent passes its supplied toolchain to the LLM even when it has no functions", async () => {
    // Motivation: the agent's dependency stays the same when a tool manager
    // removes its last function, so it must not substitute another chain.

    // 1. supply an empty toolchain and capture the LLM dependency
    let toolchain: IToolchain;
    let agent;
    let received;
    {
        toolchain = mock_toolchain({
            get_name: () => "empty_tools", get_readme: () => "", get_use_cases: () => "",
            get_tools: () => new Map(),
        });
        const llm = mock_llm({
            async generate_response(_context, options) {
                assert.ok(options);
                received = options.toolchain;
                return reply([{ role: "assistant", content: "Done" }], "Done");
            },
        });
        agent = new Agent(config, llm, toolchain, journal);
    }

    // 2. generate a response and verify the chain is still forwarded
    {
        assert.equal((await agent.generate_response()).ok, true);
        assert.strictEqual(received, toolchain);
    }
});
