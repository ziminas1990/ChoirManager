import { z } from "zod";

import { IToolchain, Tool } from "@src/interfaces/llm.js";
import { Expected } from "@src/utils/expected.js";
import { parse_tool_parameters, tool_from_schema } from "./tool_schema.js";
import { return_error, return_success } from "./tool_response.js";

const messenger_send_message_schema = z.object({
    html_text: z.string().trim().min(1).describe("Telegram HTML text to send to the managers' chat."),
}).strict();

export class ManagersMessengerTools implements IToolchain {
    constructor(
        private readonly send_message: (html_text: string) => Promise<Expected<string>>,
    ) {}

    get_name(): string {
        return "messenger";
    }

    get_readme(): string {
        return [
            "This toolchain sends messages to the managers' chat.",
            "Use messenger_send_message for every visible response.",
        ].join("\n");
    }

    get_tools(): Map<string, Tool> {
        return new Map([
            ["messenger_send_message", tool_from_schema(
                "messenger_send_message",
                [
                    "Send an HTML-formatted message to the managers' chat.",
                    "This is the only way to send a visible response.",
                    "Only Telegram-safe HTML tags are allowed: <b>, <i>, <code>, <s>, <u>, <pre>.",
                ].join("\n"),
                messenger_send_message_schema,
            )],
        ]);
    }

    async call_tool(name: string, parameters: Record<string, unknown>): Promise<Expected<string>> {
        if (name !== "messenger_send_message") {
            return Expected.err(return_error(`Unknown tool: ${name}`));
        }

        const parsed = parse_tool_parameters(messenger_send_message_schema, parameters);
        if (!parsed.ok) {
            return Expected.err(return_error(parsed.error));
        }

        const sent = await this.send_message(parsed.value.html_text);
        return sent.ok
            ? Expected.ok(return_success({ message_id: sent.value }))
            : Expected.err(return_error(sent.error));
    }
}
