import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import OpenAI from "openai";

import { OpenaiAPI } from "../dist/api/openai.js";
import { OpenaiChatCompletionsLLM } from "../dist/adapters/llm/openai_chat_completions.js";
import { OpenaiResponsesLLM } from "../dist/adapters/llm/openai_responses.js";
import { AssistantConfig, ManagersChatAgentConfig } from "../dist/config.js";
import { ScoresServiceConfig } from "../dist/adapters/scores_service/factory.js";
import { SimpleMemoryServiceConfig } from "../dist/adapters/simple_memory_service/factory.js";
import { Agent } from "../dist/components/ai/agent.js";
import { Journal } from "../dist/journal.js";
import { Expected } from "../dist/utils/expected.js";

afterEach(() => mock.restoreAll());

const prompt_file = "./config/prompts/chorister_agent.md";
const current_models = ["gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna"];
const context = [{ role: "system", content: "Reply in JSON when requested." },
    { role: "user", content: "Find the score." }];
const tool = { name: "find_score", description: "Find a score",
    parameters: { type: "object", properties: { title: { type: "string" } } } };
const logger = { info() {}, warn() {}, error() {}, debug() {} };
const journal = { child() { return this; }, log() { return logger; } };

function configurations(model) {
    return [
        new AssistantConfig({ model }),
        new ManagersChatAgentConfig({ model, prompt_file, context_days: 3 }),
        new ScoresServiceConfig({ model, type: "local", fetch_interval_sec: 60,
            search_prompt_file: prompt_file,
            storage: { type: "google_spreadsheet", google_sheet_id: "test", range: "Scores!A:Z" } }),
        new SimpleMemoryServiceConfig({ model, type: "local",
            search_prompt_file: prompt_file, ask_prompt_file: prompt_file,
            storage: { type: "google_firestore", database_id: "test", collection_name: "memory" } }),
    ];
}

function text_item(text) {
    return { type: "message", id: "msg_test", role: "assistant", status: "completed",
        content: [{ type: "output_text", text, annotations: [] }] };
}

function response(model, output = [text_item("Found")], extra = {}) {
    return { id: "resp_test", object: "response", status: "completed", model, output,
        usage: { input_tokens: 20, output_tokens: 7, total_tokens: 27,
            input_tokens_details: { cached_tokens: 5 },
            output_tokens_details: { reasoning_tokens: 2 } }, ...extra };
}

function api_fixture(replies) {
    const requests = [];
    const client = new OpenAI({ apiKey: "test-only", maxRetries: 0,
        fetch: async (url, options) => {
            requests.push({ url: String(url), body: JSON.parse(options.body) });
            const reply = replies.shift();
            assert.ok(reply, "unexpected API request");
            if (reply instanceof Error) {
                throw reply;
            }
            if (Array.isArray(reply)) {
                const sse = reply.map(event => `data: ${JSON.stringify(event)}\n\n`).join("");
                return new globalThis.Response(sse, { headers: { "content-type": "text/event-stream" } });
            }
            return new globalThis.Response(JSON.stringify(reply), {
                headers: { "content-type": "application/json" },
            });
        },
    });
    mock.method(OpenaiAPI, "get_instance", () => client);
    return requests;
}

test("all model settings require listed names and ignore letter case", () => {
    // Motivation: every workload must reject missing or unlisted model names
    // while accepting case differences in an explicitly configured selection.

    // 1. verify exact names and case variations for every current model
    for (const model of current_models) {
        // 1.1 check the same selection in each configurable workload
        for (const name of [model, model.toUpperCase(), model.replace("gpt", "Gpt")]) {
            for (const config of configurations(name)) {
                assert.equal(config.verify().ok, true);
                assert.equal(config.model, model);
            }
        }
    }

    // 2. reject missing, abbreviated, padded, and unlisted model names
    for (const model of [undefined, "", "  ", null, 6, "6.1-terra", "gpt-7-sol",
        " gpt-6.1-terra", "gpt-6.1-terra ", "gpt-6.1-terra\n",
        "gpt-6.1-terra-2026-06-01", "ft:gpt-4o-mini:org:custom", "toString"]) {
        // 2.1 verify validation rejects each unsupported model
        {
            for (const config of configurations(model)) {
                const status = config.verify();
                assert.equal(status.ok, false);
            }
        }

        // 2.2 prevent direct LLM construction from bypassing the model list
        {
            assert.throws(() => OpenaiAPI.get_llm(model));
        }
    }
});

test("older model selections remain usable and emit deprecation warnings", () => {
    // Motivation: deployments using legacy models need a migration signal
    // without losing their explicit configuration during this upgrade.

    // 1. capture warnings from model selection
    const warnings = [];
    {
        mock.method(Journal.prototype, "log", () => ({
            ...logger, warn(data, message) { warnings.push({ data, message }); },
        }));
    }

    // 2. accept only the explicitly listed deprecated models
    for (const model of ["gpt-4o", "gpt-4o-mini", "gpt-5.6-luna", "gpt-5.6-terra"]) {
        // 2.1 validate and normalize the same selection in each workload
        {
            for (const config of configurations(model.toUpperCase())) {
                assert.equal(config.verify().ok, true);
                assert.equal(config.model, model);
            }
        }
    }

    // 3. verify one warning per legacy model
    {
        assert.equal(warnings.length, 4);
        assert.equal(warnings[0].data.model, "gpt-4o");
    }

    // 4. keep current model selections free of deprecation warnings
    for (const model of current_models) {
        assert.equal(configurations(model)[0].verify().ok, true);
        assert.equal(warnings.length, 4);
    }
});

for (const model of current_models) {
    test(`${model} returns text and JSON with accurate usage`, async () => {
        // Motivation: model configuration must reach the real SDK request
        // path and preserve output contracts used by search and memory jobs.

        // 1. prepare text and JSON responses at the HTTP boundary
        let requests;
        let llm;
        {
            requests = api_fixture([response(model), response(model, [text_item('{"found":true}')])]);
            llm = OpenaiAPI.get_llm(model.toUpperCase());
            assert.ok(llm instanceof OpenaiResponsesLLM);
        }

        // 2. request plain text and verify the endpoint and returned usage
        {
            const result = await llm.generate_response(context, undefined, "text");
            assert.equal(result.ok, true);
            assert.equal(result.value.content, "Found");
            assert.equal(result.value.model, model);
            assert.deepEqual(result.value.total_usage,
                { input_tokens: 20, output_tokens: 7, cached_tokens: 5 });
            assert.match(requests[0].url, /\/v1\/responses$/);
            assert.equal(requests[0].body.model, model);
            assert.deepEqual(requests[0].body.input, context);
            assert.equal(requests[0].body.store, false);
            assert.equal(requests[0].body.text.format.type, "text");
        }

        // 3. verify that JSON mode preserves the caller's parsing contract
        {
            const result = await llm.generate_response(context, undefined, "json");
            assert.equal(result.ok, true);
            assert.deepEqual(JSON.parse(result.value.content), { found: true });
            assert.equal(requests[1].body.text.format.type, "json_object");
        }
    });

    test(`${model} completes an agent tool round trip with reasoning replay`, async () => {
        // Motivation: generation 6 agents must execute tools through Responses
        // and retain encrypted reasoning and call IDs for the next turn.

        // 1. prepare reasoning, commentary, a tool call, and a final answer
        let output;
        let requests;
        let agent;
        const executed = [];
        {
            output = [
                { type: "reasoning", id: "rs_test", summary: [], encrypted_content: "opaque-state" },
                text_item("Searching"),
                { type: "function_call", id: "fc_test", call_id: "call_test",
                    name: tool.name, arguments: '{"title":"Song"}', status: "completed" },
            ];
            requests = api_fixture([response(model, output), response(model)]);
            const toolchain = {
                get_name: () => "scores", get_readme: () => "Search scores", get_use_cases: () => "",
                get_tools: () => new Map([[tool.name, tool]]),
                async call_tool(name, parameters) {
                    executed.push({ name, parameters });
                    return Expected.ok("Score located");
                },
            };
            agent = new Agent({ instruction: "Help a singer", ttl_ms: 60_000,
                inactivity_timeout_ms: 60_000, tool_calls_limit: 1, output_format: "text" },
            OpenaiAPI.get_llm(model), toolchain, journal);
            agent.add_user_messages([{ role: "user", content: "Find Song" }]);
        }

        // 2. ask the agent to perform the search and reach a final answer
        {
            const result = await agent.generate_response();
            assert.equal(result.ok, true, result.ok ? undefined : result.error);
            assert.equal(result.value, "Found");
            assert.deepEqual(executed, [{ name: "find_score", parameters: { title: "Song" } }]);
        }

        // 3. verify the function schema and limit-enforced tool choice
        {
            assert.deepEqual(requests[0].body.tools, [{ type: "function", ...tool, strict: false }]);
            assert.equal(requests[0].body.tool_choice, "auto");
            assert.equal(requests[1].body.tool_choice, "none");
        }

        // 4. verify exact provider output replay followed by the matching tool result
        {
            const input = requests[1].body.input;
            const start = input.findIndex(item => item.id === "rs_test");
            assert.ok(start >= 0);
            assert.deepEqual(input.slice(start, start + output.length), output);
            assert.deepEqual(input[start + output.length], {
                type: "function_call_output", call_id: "call_test", output: "Score located",
            });
        }
    });

    test(`${model} streams text and JSON with final usage`, async () => {
        // Motivation: streaming callers depend on ordered text chunks and one
        // finish event containing model identity and cached-token accounting.

        // 1. exercise both supported output formats
        for (const format of ["text", "json"]) {
            // 1.1 supply text deltas and a completed response over SSE
            let requests;
            {
                requests = api_fixture([[
                    { type: "response.output_text.delta", delta: "Found" },
                    { type: "response.completed", response: response(model) },
                ]]);
            }

            // 1.2 consume the stream through the application's LLM interface
            let chunks;
            {
                const result = await OpenaiAPI.get_llm(model).generate_stream_response(context, format);
                assert.equal(result.ok, true);
                chunks = [];
                for await (const chunk of result.value) chunks.push(chunk);
            }

            // 1.3 verify output ordering, usage, and request format
            {
                assert.deepEqual(chunks, [{ type: "data", content: "Found" }, {
                    type: "finish", model, cost_cents: 0,
                    usage: { input_tokens: 20, output_tokens: 7, cached_tokens: 5 },
                }]);
                assert.equal(requests[0].body.stream, true);
                assert.equal(requests[0].body.text.format.type, format === "json" ? "json_object" : "text");
            }
        }
    });
}

const invalid_responses = [
    ["incomplete", response("gpt-6.1-terra", [], { status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" } })],
    ["failed", response("gpt-6.1-terra", [], { status: "failed",
        error: { message: "Service failure" } })],
    ["refusal", response("gpt-6.1-terra", [{ type: "message", content: [
        { type: "refusal", refusal: "Cannot answer" } ] }])],
    ["invalid arguments", response("gpt-6.1-terra", [{ type: "function_call",
        call_id: "call", name: "search", arguments: "{" }])],
    ["non-object arguments", response("gpt-6.1-terra", [{ type: "function_call",
        call_id: "call", name: "search", arguments: "[]" }])],
    ["empty output", response("gpt-6.1-terra", [])],
    ["network error", new Error("offline")],
];

for (const [name, reply] of invalid_responses) {
    test(`${name} returns an error instead of a usable answer`, async () => {
        // Motivation: partial, refused, or malformed model output must not
        // become a successful answer or trigger an invalid tool execution.

        // 1. supply the failed response through the SDK transport
        {
            api_fixture([reply]);
        }

        // 2. verify the application receives an error
        {
            const result = await OpenaiAPI.get_llm("gpt-6.1-terra").generate_response(context);
            assert.equal(result.ok, false);
        }
    });
}

for (const events of [[], [{ type: "response.incomplete", response: invalid_responses[0][1] }],
    [{ type: "error", message: "Stream failure" }]]) {
    test(`failed stream does not emit a finish event (${events[0]?.type ?? "truncated"})`, async () => {
        // Motivation: consumers must not mistake a truncated or failed SSE
        // response for a successfully completed generation.

        // 1. prepare a stream without a successful completion
        {
            api_fixture([events]);
        }

        // 2. consume it and verify failure without a success marker
        {
            const result = await OpenaiAPI.get_llm("gpt-6.1-terra").generate_stream_response(context);
            assert.equal(result.ok, true);
            const chunks = [];
            await assert.rejects(async () => {
                for await (const chunk of result.value) chunks.push(chunk);
            });
            assert.equal(chunks.some(chunk => chunk.type === "finish"), false);
        }
    });
}

for (const [model, adapter] of [["gpt-6.1-terra", OpenaiResponsesLLM],
    ["gpt-4o-mini", OpenaiChatCompletionsLLM]]) {
    test(`${model} adapter can be created before OpenAI initialization`, async () => {
        // Motivation: selecting an adapter must not change startup ordering;
        // an existing LLM must become usable once the API client is ready.

        // 1. simulate an API client that has not been initialized
        let client_lookups = 0;
        {
            mock.method(OpenaiAPI, "get_instance", () => {
                client_lookups++;
                throw new Error("OpenAI API is not initialized");
            });
        }

        // 2. select the concrete adapter without accessing the API client
        let llm;
        {
            llm = OpenaiAPI.get_llm(model.toUpperCase());
            assert.ok(llm instanceof adapter);
            assert.equal(client_lookups, 0);
        }

        // 3. report a request-time initialization error through the LLM interface
        {
            const result = await llm.generate_response(context);
            assert.equal(result.ok, false);

            assert.equal(client_lookups, 1);
        }

        // 4. make the SDK client available for the same adapter instance
        let requests;
        {
            const reply = model === "gpt-6.1-terra" ? response(model) : {
                model, choices: [{ message: { role: "assistant", content: "Found" } }],
            };
            requests = api_fixture([reply]);
        }

        // 5. verify the existing adapter can complete a request after initialization
        {
            const result = await llm.generate_response(context);
            assert.equal(result.ok, true, result.ok ? undefined : result.error);
            assert.equal(result.value.content, "Found");
            assert.equal(requests.length, 1);
        }
    });
}

test("legacy models retain Chat Completions and empty context makes no request", async () => {
    // Motivation: adding the new endpoint must preserve the legacy request
    // contract and reject empty prompts before contacting the provider.

    // 1. prepare a legacy Chat Completions response
    let requests;
    {
        requests = api_fixture([{ model: "gpt-4o-mini", choices: [
            { message: { role: "assistant", content: "Legacy answer" } }],
        usage: { prompt_tokens: 3, completion_tokens: 2 } }]);
    }

    // 2. verify the legacy model still uses its original endpoint
    {
        const llm = OpenaiAPI.get_llm("gpt-4o-mini");
        assert.ok(llm instanceof OpenaiChatCompletionsLLM);
        const result = await llm.generate_response(context);
        assert.equal(result.ok, true);
        assert.equal(result.value.content, "Legacy answer");
        assert.match(requests[0].url, /\/chat\/completions$/);
        assert.deepEqual(requests[0].body.messages, context);
    }

    // 3. verify both generation 6 entry points reject empty prompts locally
    {
        assert.equal((await OpenaiAPI.get_llm("gpt-6.1-terra").generate_response([])).ok, false);
        assert.equal((await OpenaiAPI.get_llm("gpt-6.1-terra").generate_stream_response([])).ok, false);
        assert.equal(requests.length, 1);
    }
});
