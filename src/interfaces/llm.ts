import { Expected } from "@src/utils/expected.js";

export type TokensUsage = {
    input_tokens: number;
    output_tokens: number;
    cached_tokens: number;
}

export type StreamChunk = {
    type: "data";
    content: string;
} | {
    type: "finish";
    usage: TokensUsage;
    model: string;
    cost_cents: number;
}

export type Message = {
    role: "system" | "user",
    content: string,
} | {
    role: "assistant",
    content: string,
} | {
    role: "tool_calls";
    content?: string;
    reasoning_content?: string;
    calls: {
        tool_call_id: string;
        name: string;
        parameters: Record<string, unknown>;
    }[];
} | {
    role: "tool_result";
    tool_call_id: string;
    name: string;
    result: string;
}

export type Response = {
    messages: Message[];
    content: string | null;
    model: string;
    total_usage: TokensUsage;
    cost_cents: number;
}

export type Tool = {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

export interface IToolchain {
    get_name(): string;

    get_readme(): string;

    get_tools(): Map<string, Tool>;

    call_tool(name: string, parameters: Record<string, unknown>): Promise<Expected<string>>;
}

export type ToolsOption = {
    toolchain: IToolchain;
    choice?: "auto" | "none";
}

export interface ILLM {
    generate_response(
        context: Message[],
        tools?: ToolsOption,
        response_format?: "text" | "json"
    ): Promise<Expected<Response>>;

    generate_stream_response(
        context: Message[],
        response_format?: "text" | "json"
    ): Promise<Expected<AsyncIterable<StreamChunk>>>;
}
