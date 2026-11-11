import assert from "node:assert/strict";
import { mock } from "node:test";

import OpenAI from "openai";
import { z } from "zod";

import { OpenaiAPI } from "@src/api/openai.js";

// This double operates at the HTTP boundary so malformed provider responses
// can be tested without pretending they satisfy the SDK's decoded types.
type WireObject = Record<string, unknown>;
const request_body = z.object({
    text: z.object({ format: z.object({ type: z.string() }) }).optional(),
    input: z.array(z.record(z.unknown())).optional(),
}).passthrough();

export function text_item(text: string): WireObject {
    return { type: "message", id: "msg_test", role: "assistant", status: "completed",
        content: [{ type: "output_text", text, annotations: [] }] };
}

export function response(model: string, output: WireObject[] = [text_item("Found")], extra: WireObject = {}): WireObject {
    return { id: "resp_test", object: "response", status: "completed", model, output,
        usage: { input_tokens: 20, output_tokens: 7, total_tokens: 27,
            input_tokens_details: { cached_tokens: 5 },
            output_tokens_details: { reasoning_tokens: 2 } }, ...extra };
}

export function api_fixture(replies: (WireObject | WireObject[] | Error)[]) {
    const requests: { url: string; body: z.infer<typeof request_body> }[] = [];
    const client = new OpenAI({ apiKey: "test-only", maxRetries: 0,
        fetch: async (url, options) => {
            assert.equal(typeof options?.body, "string");
            assert.ok(options && typeof options.body === "string");
            const body: unknown = JSON.parse(options.body);
            requests.push({ url: String(url), body: request_body.parse(body) });
            const reply = replies.shift();
            assert.ok(reply, "unexpected API request");
            if (reply instanceof Error) throw reply;
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
