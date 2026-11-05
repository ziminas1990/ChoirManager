import OpenAI from "openai";
import {
    ChatCompletionMessage,
    ChatCompletionMessageParam,
    ChatCompletionTool,
} from "openai/resources/chat/completions";
import { ResponseFormatJSONObject, ResponseFormatText } from "openai/resources/shared";
import { Expected } from "@src/utils/expected.js";
import { ILLM, IToolchain, Message, Response, StreamChunk, TokensUsage, ToolsOption } from "@src/interfaces/llm.js";

type OpenaiUsage = {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: {
        cached_tokens?: number;
    };
}

function get_response_format(response_format?: "text" | "json") {
    if (response_format === "text") {
        return { type: "text" } as ResponseFormatText;
    } else if (response_format === "json") {
        return { type: "json_object" } as ResponseFormatJSONObject;
    }
    return undefined;
}

function tools_to_openai(tools: IToolchain): ChatCompletionTool[] {
    return Array.from(tools.get_tools().values()).map(tool => ({
        type: "function" as const,
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        },
    }));
}

function to_openai_messages(context: Message[]): Expected<ChatCompletionMessageParam[]> {
    const messages: ChatCompletionMessageParam[] = [];

    for (const message of context) {
        if (message.role === "system" || message.role === "user" || message.role === "assistant") {
            messages.push({
                role: message.role,
                content: message.content,
            });
        } else if (message.role === "tool_calls") {
            messages.push({
                role: "assistant",
                content: message.content ?? null,
                tool_calls: message.calls.map(call => ({
                    id: call.tool_call_id,
                    type: "function" as const,
                    function: {
                        name: call.name,
                        arguments: JSON.stringify(call.parameters),
                    },
                })),
            });
        } else if (message.role === "tool_result") {
            messages.push({
                role: "tool",
                content: message.result,
                tool_call_id: message.tool_call_id,
            });
        } else {
            return Expected.err(`unsupported message role "${(message as Message).role}"`);
        }
    }

    return Expected.ok(messages);
}

function to_response_message(choice_message: ChatCompletionMessage): Expected<Message> {
    if (choice_message.tool_calls && choice_message.tool_calls.length > 0) {
        const calls: Extract<Message, { role: "tool_calls" }>["calls"] = [];

        for (const tool_call of choice_message.tool_calls) {
            if (tool_call.type !== "function") {
                return Expected.err(`unsupported tool call type "${tool_call.type}"`);
            }

            let parameters: unknown;
            try {
                parameters = JSON.parse(tool_call.function.arguments);
            } catch(e) {
                return Expected.exception(
                    `failed to parse arguments for tool "${tool_call.function.name}"`, e);
            }

            if (parameters === null || Array.isArray(parameters) || typeof parameters !== "object") {
                return Expected.err(`tool "${tool_call.function.name}" arguments must be a JSON object`);
            }

            calls.push({
                tool_call_id: tool_call.id,
                name: tool_call.function.name,
                parameters: parameters as Record<string, unknown>,
            });
        }

        return Expected.ok({
            role: "tool_calls",
            content: choice_message.content ?? undefined,
            calls,
        });
    }

    if (choice_message.content !== null) {
        return Expected.ok({ role: "assistant", content: choice_message.content });
    }

    return Expected.err("no content or tool calls in the response");
}

function tokens_usage_from_openai(usage: OpenaiUsage | undefined): TokensUsage {
    return {
        input_tokens: usage?.prompt_tokens ?? 0,
        output_tokens: usage?.completion_tokens ?? 0,
        cached_tokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
    };
}

export class OpenaiChatCompletionsLLM implements ILLM {
    constructor(private readonly model: string, private readonly get_client: () => OpenAI) {}

    async generate_response(
        context: Message[],
        tools?: ToolsOption,
        response_format?: "text" | "json"
    ): Promise<Expected<Response>> {
        try {
            const openai_messages = to_openai_messages(context);
            if (!openai_messages.ok) {
                return openai_messages.wrap_error("failed to convert context to OpenAI format");
            }

            const messages = openai_messages.value;
            if (messages.length === 0) {
                return Expected.err("no messages to generate response");
            }

            const openai_tools = tools ? tools_to_openai(tools.toolchain) : [];
            const completion = await this.get_client().chat.completions.create({
                model: this.model,
                messages,
                response_format: get_response_format(response_format),
                tools: openai_tools.length > 0 ? openai_tools : undefined,
                tool_choice: openai_tools.length > 0 ? tools?.choice ?? "auto" : undefined
            });

            if (completion.choices.length === 0) {
                return Expected.err("no response from the model");
            }

            const response_message = to_response_message(completion.choices[0].message);
            if (!response_message.ok) {
                return response_message.wrap_error("failed to parse OpenAI response");
            }

            const msg = response_message.value;
            return Expected.ok({
                messages: [msg],
                content: msg.role === "assistant" ? msg.content : null,
                model: completion.model,
                total_usage: tokens_usage_from_openai(completion.usage),
                cost_cents: 0,
            });
        } catch (e) {
            return Expected.exception("OpenAI API exception", e);
        }
    }

    async generate_stream_response(
        context: Message[],
        response_format?: "text" | "json"
    ): Promise<Expected<AsyncIterable<StreamChunk>>> {
        try {
            const openai_messages = to_openai_messages(context);
            if (!openai_messages.ok) {
                return openai_messages.wrap_error("failed to convert context to OpenAI format");
            }

            const messages = openai_messages.value;
            if (messages.length === 0) {
                return Expected.err("no messages to generate response");
            }

            const stream = await this.get_client().chat.completions.create({
                model: this.model,
                messages,
                response_format: get_response_format(response_format),
                stream: true,
                stream_options: {
                    include_usage: true,
                },
            });

            const async_generator = async function* (): AsyncIterable<StreamChunk> {
                const total_usage: TokensUsage = {
                    input_tokens: 0,
                    output_tokens: 0,
                    cached_tokens: 0,
                };
                let model = "unknown";

                for await (const chunk of stream) {
                    model = chunk.model || model;
                    if (chunk.usage) {
                        total_usage.input_tokens += chunk.usage.prompt_tokens;
                        total_usage.output_tokens += chunk.usage.completion_tokens;
                        total_usage.cached_tokens +=
                            chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
                    }

                    if (chunk.choices.length === 0) {
                        continue;
                    }

                    const content = chunk.choices[0].delta?.content;
                    if (content) {
                        yield {
                            type: "data",
                            content,
                        };
                    }
                }

                yield {
                    type: "finish",
                    usage: total_usage,
                    model,
                    cost_cents: 0,
                };
            };

            return Expected.ok(async_generator());
        } catch (e) {
            return Expected.exception("OpenAI API streaming exception", e);
        }
    }
}
