import OpenAI from "openai";
import {
    Response as OpenaiResponse,
    ResponseCreateParamsBase,
    ResponseInputItem,
    ResponseUsage,
} from "openai/resources/responses/responses";
import { ILLM, Message, Response, StreamChunk, TokensUsage, ToolsOption } from "@src/interfaces/llm.js";
import { Expected } from "@src/utils/expected.js";

export class OpenaiResponsesLLM implements ILLM {
    constructor(private readonly model: string, private readonly get_client: () => OpenAI) {}

    async generate_response(
        context: Message[],
        tools?: ToolsOption,
        response_format?: "text" | "json",
    ): Promise<Expected<Response>> {
        if (context.length === 0) {
            return Expected.err("no messages to generate response");
        }
        try {
            const response = await this.get_client().responses.create({
                ...Helpers.request(this.model, context, response_format, tools),
                stream: false,
            });
            return Helpers.response(response);
        } catch (e) {
            return Expected.exception("OpenAI Responses API exception", e);
        }
    }

    async generate_stream_response(
        context: Message[],
        response_format?: "text" | "json",
    ): Promise<Expected<AsyncIterable<StreamChunk>>> {
        if (context.length === 0) {
            return Expected.err("no messages to generate response");
        }
        try {
            const stream = await this.get_client().responses.create({
                ...Helpers.request(this.model, context, response_format),
                stream: true,
            });
            const chunks = async function* (): AsyncIterable<StreamChunk> {
                for await (const event of stream) {
                    if (event.type === "response.output_text.delta") {
                        yield { type: "data", content: event.delta };
                    } else if (event.type === "response.completed") {
                        const parsed = Helpers.response(event.response);
                        if (!parsed.ok) {
                            throw new Error(parsed.error);
                        }
                        yield {
                            type: "finish",
                            usage: parsed.value.total_usage,
                            model: parsed.value.model,
                            cost_cents: 0,
                        };
                        return;
                    } else if (event.type === "response.failed" || event.type === "response.incomplete") {
                        throw new Error(Helpers.failure(event.response));
                    } else if (event.type === "error") {
                        throw new Error(event.message);
                    }
                }
                throw new Error("OpenAI response stream ended without completion");
            };
            return Expected.ok(chunks());
        } catch (e) {
            return Expected.exception("OpenAI Responses API streaming exception", e);
        }
    }
}

class Helpers {
    static request(
        model: string,
        context: Message[],
        response_format?: "text" | "json",
        tools?: ToolsOption,
    ): ResponseCreateParamsBase {
        const input: ResponseInputItem[] = [];
        for (const message of context) {
            if ((message.role === "assistant" || message.role === "tool_calls")
                && message.provider_data?.openai_responses) {
                input.push(...message.provider_data.openai_responses as unknown as ResponseInputItem[]);
            } else if (message.role === "tool_calls") {
                if (message.content) {
                    input.push({ role: "assistant", content: message.content });
                }
                for (const call of message.calls) {
                    input.push({
                        type: "function_call", call_id: call.tool_call_id,
                        name: call.name, arguments: JSON.stringify(call.parameters),
                    });
                }
            } else if (message.role === "tool_result") {
                input.push({
                    type: "function_call_output", call_id: message.tool_call_id,
                    output: message.result,
                });
            } else {
                input.push({ role: message.role, content: message.content });
            }
        }
        const functions = tools ? Array.from(tools.toolchain.get_tools().values()) : [];
        return {
            model,
            input,
            store: false,
            include: ["reasoning.encrypted_content"],
            text: response_format ? {
                format: { type: response_format === "json" ? "json_object" : "text" },
            } : undefined,
            tools: functions.length > 0 ? functions.map(tool => ({
                type: "function", name: tool.name, description: tool.description,
                parameters: tool.parameters, strict: false,
            })) : undefined,
            tool_choice: functions.length > 0 ? tools?.choice ?? "auto" : undefined,
        };
    }

    static response(response: OpenaiResponse): Expected<Response> {
        if (response.status !== "completed") {
            return Expected.err(Helpers.failure(response));
        }
        const calls: Extract<Message, { role: "tool_calls" }>["calls"] = [];
        let content = "";
        for (const item of response.output) {
            if (item.type === "function_call") {
                let parameters: unknown;
                try {
                    parameters = JSON.parse(item.arguments);
                } catch (e) {
                    return Expected.exception(`failed to parse arguments for tool "${item.name}"`, e);
                }
                if (!parameters || Array.isArray(parameters) || typeof parameters !== "object") {
                    return Expected.err(`tool "${item.name}" arguments must be a JSON object`);
                }
                calls.push({ tool_call_id: item.call_id, name: item.name,
                    parameters: parameters as Record<string, unknown> });
            } else if (item.type === "message") {
                for (const part of item.content) {
                    if (part.type === "refusal") {
                        return Expected.err(`OpenAI model refused the request: ${part.refusal}`);
                    }
                    content += part.text;
                }
            } else if (item.type !== "reasoning") {
                return Expected.err(`unsupported OpenAI output type "${item.type}"`);
            }
        }
        const provider_data = { openai_responses: response.output.map(item => ({ ...item })) };
        let message: Message;
        if (calls.length > 0) {
            message = { role: "tool_calls", calls, content: content || undefined, provider_data };
        } else if (content) {
            message = { role: "assistant", content, provider_data };
        } else {
            return Expected.err("no content or tool calls in the response");
        }
        return Expected.ok({
            messages: [message], content: calls.length > 0 ? null : content,
            model: response.model, total_usage: Helpers.usage(response.usage), cost_cents: 0,
        });
    }

    static failure(response: OpenaiResponse): string {
        return response.error?.message
            ?? `OpenAI response ${response.status}: ${response.incomplete_details?.reason ?? "no completion"}`;
    }

    static usage(usage: ResponseUsage | undefined): TokensUsage {
        return {
            input_tokens: usage?.input_tokens ?? 0,
            output_tokens: usage?.output_tokens ?? 0,
            cached_tokens: usage?.input_tokens_details?.cached_tokens ?? 0,
        };
    }
}
