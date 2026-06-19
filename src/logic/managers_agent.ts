import fs from "fs";

import { OpenaiAPI } from "@src/api/openai.js";
import { Agent } from "@src/components/ai/agent.js";
import { ManagersChatAgentConfig } from "@src/config.js";
import { IManagersChat } from "@src/interfaces/adapter.js";
import { IToolchain, Message, Tool } from "@src/interfaces/llm.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";
import { GroupChat, GroupChatMessage } from "./group_chat.js";

type AgentResponse = {
    status: "done";
} | {
    status: "error";
    description: string;
}

type ManagersAgentDependencies = {
    get_managers_chat: () => Promise<IManagersChat | undefined>;
    resolve_author: (user_id: string) => string;
    bot_id: string;
}

function format_message_time(time: Date): string {
    const day = time.getDate().toString().padStart(2, "0");
    const month = (time.getMonth() + 1).toString().padStart(2, "0");
    const hours = time.getHours().toString().padStart(2, "0");
    const minutes = time.getMinutes().toString().padStart(2, "0");
    return `${day}.${month}, ${hours}:${minutes}`;
}

function return_success<T>(value: T): string {
    return JSON.stringify({ value });
}

function return_error(error: string): string {
    return JSON.stringify({ error });
}

function parse_agent_response(text: string): Expected<AgentResponse> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        return Expected.exception("failed to parse agent response", e);
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return Expected.err("agent response must be a JSON object");
    }

    const response = parsed as Record<string, unknown>;
    if (response.status === "done") {
        return Expected.ok({ status: "done" });
    }
    if (response.status === "error") {
        if (typeof response.description !== "string" || response.description.trim().length === 0) {
            return Expected.err("error response must include non-empty description");
        }
        return Expected.ok({
            status: "error",
            description: response.description,
        });
    }
    return Expected.err("response status must be either 'sent' or 'error'");
}

class ManagersMessengerTools implements IToolchain {
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
            ["messenger_send_message", {
                name: "messenger_send_message",
                description: [
                    "Send an HTML-formatted message to the managers' chat.",
                    "This is the only way to send a visible response.",
                    "Only Telegram-safe HTML tags are allowed: <b>, <i>, <code>, <s>, <u>, <pre>.",
                ].join("\n"),
                parameters: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                        html_text: {
                            type: "string",
                            description: "Telegram HTML text to send to the managers' chat.",
                        },
                    },
                    required: ["html_text"],
                },
            }],
        ]);
    }

    async call_tool(name: string, parameters: Record<string, unknown>): Promise<Expected<string>> {
        if (name !== "messenger_send_message") {
            return Expected.err(return_error(`Unknown tool: ${name}`));
        }

        const html_text = parameters.html_text;
        if (typeof html_text !== "string" || html_text.trim().length === 0) {
            return Expected.err(return_error("'html_text' must be a non-empty string"));
        }

        const sent = await this.send_message(html_text);
        return sent.ok
            ? Expected.ok(return_success({ message_id: sent.value }))
            : Expected.err(return_error(sent.error));
    }
}

export class ManagersAgent {
    private readonly journal: Journal;
    private agent?: Agent;

    constructor(
        private readonly config: ManagersChatAgentConfig,
        private readonly chat: GroupChat,
        private readonly dependencies: ManagersAgentDependencies,
        parent_journal: Journal,
    ) {
        this.journal = parent_journal.child("managers_agent");
    }

    async init(): Promise<Status> {
        const instruction_status = this.read_instruction();
        if (!instruction_status.ok) {
            return instruction_status.wrap_error("failed to read managers agent prompt");
        }

        this.agent = new Agent(
            {
                instruction: instruction_status.value,
                ttl_ms: this.config.context_days * 24 * 60 * 60 * 1000,
                inactivity_timeout_ms: 0,
                tool_calls_limit: 12,
                output_format: "json",
            },
            OpenaiAPI.get_llm(this.config.model),
            this.journal,
            new ManagersMessengerTools((html_text) => this.send_agent_message(html_text)),
        );

        const now = new Date();
        const from = new Date(now.getTime() - this.config.context_days * 24 * 60 * 60 * 1000);
        const messages = await this.chat.fetch_messages(from, now);
        if (!messages.ok) {
            return messages.wrap_error("failed to fetch managers chat backlog");
        }

        messages.value
            .sort((a, b) => a.time.getTime() - b.time.getTime())
            .forEach((message) => this.add_message_to_context(message));

        return Expected.ok(undefined);
    }

    async on_new_message(message: GroupChatMessage): Promise<Status> {
        this.journal.log().info(`new managers chat message: ${message.text}`);
        if (!this.agent) {
            return Expected.err("ManagersAgent is not initialized");
        }

        this.add_message_to_context(message);

        if (!this.is_bot_mentioned(message.text)) {
            return Expected.ok(undefined);
        }

        return await this.with_typing_indicator(async () => {
            this.journal.log().info("Requesting managers agent response");
            const response = await this.agent!.generate_response();
            if (!response.ok) {
                return response.wrap_error("failed to generate managers chat response").as_status();
            }

            const parsed = parse_agent_response(response.value);
            if (!parsed.ok) {
                return parsed.wrap_error("managers agent returned invalid response").as_status();
            }
            if (parsed.value.status === "error") {
                return Expected.err(parsed.value.description);
            }
            this.journal.log().info("Managers agent response received");
            return Expected.ok(undefined);
        });
    }

    private read_instruction(): Expected<string> {
        try {
            return Expected.ok(fs.readFileSync(this.config.prompt_file, "utf-8").trim());
        } catch (e) {
            return Expected.exception("failed to read prompt file", e);
        }
    }

    private is_bot_mentioned(text: string): boolean {
        return text.includes(`@${this.dependencies.bot_id}`);
    }

    private add_message_to_context(message: GroupChatMessage): void {
        this.agent!.add_context_message(this.to_context_message(message), message.time);
    }

    private to_context_message(message: GroupChatMessage): Message {
        const author = this.is_bot_message(message)
            ? "Ursa Major Bot"
            : this.dependencies.resolve_author(message.user_id);

        return {
            role: this.is_bot_message(message) ? "assistant" : "user",
            content: [
                `id: ${message.message_id}`,
                `time: ${format_message_time(message.time)}`,
                `author: ${author}`,
                "text:",
                message.text,
            ].join("\n"),
        };
    }

    private is_bot_message(message: GroupChatMessage): boolean {
        return message.user_id === this.dependencies.bot_id;
    }

    private async send_agent_message(html_text: string): Promise<Expected<string>> {
        const managers_chat = await this.dependencies.get_managers_chat();
        if (!managers_chat) {
            return Expected.err("Managers chat sender is not available");
        }

        const sent = await managers_chat.send_message(html_text);
        if (!sent.ok) {
            return sent.wrap_error("failed to send message to managers chat");
        }

        const outgoing: GroupChatMessage = {
            time: new Date(),
            message_id: sent.value,
            user_id: this.dependencies.bot_id,
            text: html_text,
        };
        this.chat.on_new_message(outgoing);
        this.add_message_to_context(outgoing);
        return Expected.ok(sent.value);
    }

    private async with_typing_indicator<T>(operation: () => Promise<T>): Promise<T> {
        await this.send_typing_indicator();

        const typing_interval = setInterval(() => {
            void this.send_typing_indicator();
        }, 3000);

        try {
            return await operation();
        } finally {
            clearInterval(typing_interval);
        }
    }

    private async send_typing_indicator(): Promise<void> {
        const managers_chat = await this.dependencies.get_managers_chat();
        if (!managers_chat) {
            this.journal.log().warn("Managers chat sender is not available for typing action");
            return;
        }

        const status = await managers_chat.send_typing_action();
        if (!status.ok) {
            this.journal.log().warn(`Failed to send typing action: ${status.error}`);
        }
    }
}
