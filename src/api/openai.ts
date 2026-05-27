import OpenAI from "openai";
import fs from "fs";
import {
    ChatCompletionMessage,
    ChatCompletionMessageParam,
    ChatCompletionTool
} from "openai/resources/chat/completions";
import { ResponseFormatJSONObject, ResponseFormatText } from "openai/resources/shared";
import { Config } from "@src/config.js";
import { Expected, Status } from "@src/utils/expected.js";
import { return_exception, return_fail } from "@src/utils.js";
import { Journal } from "@src/journal.js";
import { ILLM, IToolchain, Message, Response, StreamChunk, TokensUsage, ToolsOption } from "@src/interfaces/llm.js";

export type OpenaiModel = "gpt-4o-mini" | "gpt-4o" | "o3";

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

export class OpenaiAPI {
    private static _instance: OpenAI;

    public static init(): Status {
        if (!Config.HasOpenAI()) {
            return Expected.err("OpenAI API key is not specified");
        }
        if (this._instance) {
            return Expected.err("OpenAI API is already initialized");
        }
        const api_key = fs.readFileSync(Config.data.openai_api_key_file!, "utf-8").trim();
        this._instance = new OpenAI({ apiKey: api_key, });
        return Expected.ok(undefined);
    }

    public static is_available(): boolean {
        return this._instance !== undefined;
    }

    public static get_instance(): OpenAI {
        if (!this._instance) {
            throw new Error("OpenAI API is not initialized");
        }
        return this._instance;
    }

    public static get_llm(model: OpenaiModel): ILLM {
        return new OpenaiLLM(model);
    }
}

export class OpenaiLLM implements ILLM {

    constructor(private model: OpenaiModel) {}

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
            const completion = await OpenaiAPI.get_instance().chat.completions.create({
                model: this.model,
                messages,
                response_format: get_response_format(response_format),
                tools: openai_tools.length > 0 ? openai_tools : undefined,
                tool_choice: openai_tools.length > 0 ? tools?.choice ?? "auto" : undefined,
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

            const stream = await OpenaiAPI.get_instance().chat.completions.create({
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

// TODO: deprecated and should be removed once it is possible
export class ChatWithHistory {
    private system_message?: Message;
    private history: Message[];
    private history_length_sym: number = 0;

    constructor(
        private llm: ILLM,
        private response_format: "text" | "json",
        private readonly journal: Journal,
        private max_history_length_sym: number = 0x4000,
        private max_message_length_sym: number = 0x1000)
    {
        this.history = [];
    }

    // NOTE: This doesn't send message!
    public set_system_message(message: string) {
        this.system_message = { role: "system", content: message };
    }

    public async send_message(message: string, add_response_to_history: boolean = true)
    : Promise<Expected<string>>
    {
        if (message.length > this.max_message_length_sym) {
            return return_fail("Message is too long", this.journal.log());
        }

        this.push_to_history({ role: "user", content: message });

        const messages: Message[] = [];
        if (this.system_message) {
            messages.push(this.system_message);
        }
        messages.push(...this.history);

        try {
            this.journal.log().info(`sending message: ${message}`);
            const completion = await this.llm.generate_response(
                messages, undefined, this.response_format);
            if (!completion.ok) {
                return return_fail(completion.error, this.journal.log());
            }

            const response = completion.value.content;
            if (!response) {
                return return_fail("no response", this.journal.log());
            }

            if (add_response_to_history) {
                this.history.push(...completion.value.messages);
            }
            return Expected.ok(response);
        } catch (error) {
            return return_exception(error, this.journal.log());
        }
    }

    // Add the specified message to the history as a response from bot to user
    public async add_response(message: string, prefix: string = ""): Promise<Status> {
        const content = (prefix ? `[${prefix}]\n` : "") + message;
        this.history.push({ role: "assistant", content });
        return Expected.ok(undefined);
    }

    private push_to_history(message: Message) {
        this.history.push(message);
        if (message.role === "system" || message.role === "user" || message.role === "assistant") {
            this.history_length_sym += message.content.length;
        }
        this.fit_history_to_max_length();
    }

    private fit_history_to_max_length() {
        if (this.history.length == 0) {
            return;
        }

        // Remove oldest messages until the history length is less than the max length
        while (this.history_length_sym > this.max_history_length_sym) {
            const oldest_message = this.history.shift();
            if (!oldest_message) {
                return;
            }
            if (oldest_message.role === "system"
                || oldest_message.role === "user"
                || oldest_message.role === "assistant") {
                this.history_length_sym -= oldest_message.content.length;
            }
        }
    }
}