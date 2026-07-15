import { z } from "zod";

import { IToolchain, Tool } from "@src/interfaces/llm.js";
import { Expected, Status } from "@src/utils/expected.js";
import { parse_tool_parameters, tool_from_schema } from "./tool_schema.js";
import { return_error, return_success, status_to_expected } from "./tool_response.js";

const messenger_send_message_schema = z.object({
    html_text: z.string().trim().min(1).describe("Telegram HTML text to send."),
}).strict();

type MessengerToolsConfig = {
    send_message: (html_text: string) => Promise<Status>;
}

const MESSENGER_USE_CASES = `
Use "messenger_send_message" to send a custom message to chat.
NOTE: do not send custom messages when following any of the known use cases unless you are explicitly told to do so.
`.trim();

export class MessengerTools implements IToolchain {
    constructor(
        private readonly config: MessengerToolsConfig,
    ) {}

    get_name(): string {
        return "messanger";
    }

    get_readme(): string {
        return [
            "This toolchain sends messages to chat.",
            "Use messenger_send_message for every visible response.",
        ].join("\n");
    }

    get_use_cases(): string {
        return MESSENGER_USE_CASES;
    }

    get_tools(): Map<string, Tool> {
        return new Map([
            ["messenger_send_message", tool_from_schema(
                "messenger_send_message",
                [
                    "Send an HTML-formatted message to chat.",
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

        const status = await this.config.send_message(parsed.value.html_text);
        return status_to_expected(status, return_success(true));
    }
}
