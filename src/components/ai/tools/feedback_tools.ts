import { z } from "zod";

import { IToolchain, Tool } from "@src/interfaces/llm.js";
import { Expected, Status } from "@src/utils/expected.js";
import { parse_tool_parameters, tool_from_schema } from "./tool_schema.js";
import { return_error, return_success, status_to_expected } from "./tool_response.js";

const feedback_start_schema = z.object({
    details: z.string().optional().describe("Optional feedback text already provided by the user."),
}).strict();

export class FeedbackTools implements IToolchain {
    constructor(
        private start_feedback: (details?: string) => Promise<Status>,
    ) {}

    get_name(): string {
        return "feedback";
    }

    get_readme(): string {
        return [
            "Tools for collecting user feedback and complaints for the org group.",
            "Use feedback_start to open the feedback flow.",
        ].join("\n");
    }

    get_tools(): Map<string, Tool> {
        return new Map([
            ["feedback_start", tool_from_schema(
                "feedback_start",
                "Start the feedback flow. If the user already provided feedback text, pass it as details.",
                feedback_start_schema,
            )],
        ]);
    }

    async call_tool(name: string, parameters: Record<string, unknown>): Promise<Expected<string>> {
        if (name !== "feedback_start") {
            return Expected.err(return_error(`Unknown tool: ${name}`));
        }

        const parsed = parse_tool_parameters(feedback_start_schema, parameters);
        if (!parsed.ok) {
            return Expected.err(return_error(parsed.error));
        }

        const status = await this.start_feedback(parsed.value.details);
        return status_to_expected(status, return_success(true));
    }
}
