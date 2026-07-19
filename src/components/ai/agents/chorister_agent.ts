import fs from "fs";

import { Expected, Status } from "@src/utils/expected.js";
import { OpenaiAPI } from "@src/api/openai.js";
import { AssistantConfig } from "@src/config.js";
import { Journal } from "@src/journal.js";
import { Agent } from "@src/components/ai/agent.js";
import { IToolchain } from "@src/interfaces/llm.js";

export class ChoristerAgent {
    private readonly agent: Agent;

    constructor(
        config: AssistantConfig,
        journal: Journal,
    ) {
        const instruction = fs.readFileSync(config.prompt_file, "utf-8").trim();

        this.agent = new Agent(
            {
                instruction,
                ttl_ms: 30 * 60 * 1000,
                inactivity_timeout_ms: 6 * 60 * 60 * 1000,
                tool_calls_limit: 5,
                output_format: "json",
            },
            OpenaiAPI.get_llm(config.model),
            journal,
        );
    }

    public add_tool(toolchain: IToolchain): Status {
        return this.agent.add_tool(toolchain);
    }

    public async send_message(message: string): Promise<Status> {
        try {
            this.agent.add_user_messages([
                { role: "user", content: message },
            ]);
            const response = await this.agent.generate_response();
            if (!response.ok) {
                return Expected.err("agent failed to send message", response);
            }

            const parsed = parse_agent_response_status(response.value);
            if (!parsed.ok) {
                return parsed.add_context("agent returned invalid status").wrap_error("agent returned invalid status");
            }
            if (parsed.value.status === "error") {
                return Expected.err(parsed.value.description);
            }
            return Expected.ok(undefined);
        } catch (e) {
            return Expected.exception("can't send message", e);
        }
    }

    public async add_response(message: string): Promise<Status> {
        this.agent.add_assistant_message(`[bot to user]\n${message}`);
        return Expected.ok(undefined);
    }
}

type AgentResponse = {
    status: "success";
} | {
    status: "error";
    description: string;
}

function parse_agent_response_status(text: string): Expected<AgentResponse> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        return Expected.exception("failed to parse response JSON", e);
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return Expected.err("response must be an object");
    }

    const response = parsed as Record<string, unknown>;
    if (response.status === "success") {
        return Expected.ok({ status: "success" });
    }
    if (response.status === "error") {
        if (typeof response.description !== "string" || response.description.trim() === "") {
            return Expected.err("error response must include non-empty description");
        }
        return Expected.ok({
            status: "error",
            description: response.description,
        });
    }

    return Expected.err("response status must be either 'success' or 'error'");
}
