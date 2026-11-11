import { Message, Response } from "@src/interfaces/llm.js";
import { Expected } from "@src/utils/expected.js";

export function reply(messages: Message[], content: string | null): Expected<Response> {
    return Expected.ok({ messages, content, model: "test",
        total_usage: { input_tokens: 0, output_tokens: 0, cached_tokens: 0 }, cost_cents: 0 });
}

export function complete_reply(partial: Pick<Response, "messages" | "content">): Expected<Response> {
    return reply(partial.messages, partial.content);
}
