import { z } from "zod";

import { IToolchain, Tool } from "@src/interfaces/llm.js";
import { Expected, Status } from "@src/utils/expected.js";
import { parse_tool_parameters, tool_from_schema } from "./tool_schema.js";
import { return_error, return_success, status_to_expected } from "./tool_response.js";

const messanger_send_message_schema = z.object({
    html_text: z.string().trim().min(1).describe("Text to send to the user in Telegram HTML format."),
}).strict();

export class MessangerTools implements IToolchain {
    constructor(
        private send_message: (html_text: string) => Promise<Status>,
    ) {}

    get_name(): string {
        return "messanger";
    }

    get_readme(): string {
        return [
            "A set of calls to communicate with the user.",
            "Use messanger_send_message to send the actual text response to the user.",
        ].join("\n");
    }

    get_tools(): Map<string, Tool> {
        return new Map([
            ["messanger_send_message", tool_from_schema(
                "messanger_send_message",
                [
                    "Send an HTML-formatted message to the user.",
                    "Use this for greetings, clarifications, refusals and regular answers.",
                    "Only Telegram-safe HTML tags are allowed: <b>, <i>, <code>, <s>, <u>, <pre>.",
                ].join("\n"),
                messanger_send_message_schema,
            )],
        ]);
    }

    async call_tool(name: string, parameters: Record<string, unknown>): Promise<Expected<string>> {
        if (name !== "messanger_send_message") {
            return Expected.err(return_error(`Unknown tool: ${name}`));
        }

        const parsed = parse_tool_parameters(messanger_send_message_schema, parameters);
        if (!parsed.ok) {
            return Expected.err(return_error(parsed.error));
        }

        const status = await this.send_message(parsed.value.html_text);
        return status_to_expected(status, return_success(true));
    }
}
