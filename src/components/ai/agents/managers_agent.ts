import fs from "fs";

import { OpenaiAPI } from "@src/api/openai.js";
import { Agent, AgentCfg } from "@src/components/ai/agent.js";
import { ChatContextBuilder } from "@src/components/chat_context_builder.js";
import { MessengerTools } from "@src/components/ai/tools/messenger_tools.js";
import { ToolsMultiplexer } from "@src/components/ai/tools/multiplexer.js";
import { SimpleMemoryTools } from "@src/components/ai/tools/simple_memory_tools.js";
import { ManagersChatAgentConfig } from "@src/config.js";
import { IManagersChat } from "@src/interfaces/adapter.js";
import { IToolchain, Message } from "@src/interfaces/llm.js";
import { IBroadcaster, ISubscription } from "@src/interfaces/message_queue.js";
import { Journal } from "@src/journal.js";
import { render_task_tracker_event } from "@src/utils/string_engine/task_tracker.js";
import { Expected, Status } from "@src/utils/expected.js";
import { IMessagesBacklog, Message as ChatMessage } from "@src/interfaces/messages_backlog.js";
import { save_message } from "@src/utils/messages_backlog.js";
import { TaskTrackerEvent } from "@src/interfaces/task_tracker_service.js";
import { IUserServiceReplica } from "@src/interfaces/user_service.js";

type AgentResponse = {
    status: "done";
} | {
    status: "error";
    description: string;
}

type ManagersAgentDependencies = {
    get_managers_chat: () => Promise<IManagersChat | undefined>;
    bot_id: string;
}

function format_message_time(time: Date): string {
    const day = time.getDate().toString().padStart(2, "0");
    const month = (time.getMonth() + 1).toString().padStart(2, "0");
    const hours = time.getHours().toString().padStart(2, "0");
    const minutes = time.getMinutes().toString().padStart(2, "0");
    return `${day}.${month}, ${hours}:${minutes}`;
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

export class ManagersAgent {
    private readonly journal: Journal;
    private readonly task_tracker_subscription: ISubscription<TaskTrackerEvent>;
    private context_builder?: ChatContextBuilder;
    private agent_config?: AgentCfg;
    private tools?: IToolchain;

    // Queue of incoming messages, processed in proceed()
    private new_messages_queue: ChatMessage[] = [];

    constructor(
        private readonly config: ManagersChatAgentConfig,
        private readonly backlog: IMessagesBacklog,
        task_tracker_events: IBroadcaster<TaskTrackerEvent>,
        private readonly dependencies: ManagersAgentDependencies,
        private readonly extra_tools: IToolchain | undefined,
        private readonly simple_memory_tools: SimpleMemoryTools | undefined,
        private readonly users: IUserServiceReplica,
        parent_journal: Journal,
    ) {
        this.journal = parent_journal.child("managers_agent");
        this.task_tracker_subscription = task_tracker_events.subscribe();
    }

    async init(): Promise<Status> {
        const instruction_status = this.read_instruction();
        if (!instruction_status.ok) {
            return instruction_status.wrap_error("failed to read managers agent prompt");
        }

        const tools = new ToolsMultiplexer(this.journal.child("mux"));
        let status = tools.add_tool(new MessengerTools({
            send_message: async (html_text) => (await this.publish_message(html_text)).as_status(),
        }));
        if (!status.ok) {
            return status.wrap_error("failed to register managers messenger tools");
        }
        if (this.extra_tools) {
            status = tools.add_tool(this.extra_tools);
            if (!status.ok) {
                return status.wrap_error("failed to register extra managers agent tools");
            }
        }
        if (this.simple_memory_tools) {
            status = tools.add_tool(this.simple_memory_tools);
            if (!status.ok) {
                return status.wrap_error("failed to register simple memory tools");
            }
        }

        this.context_builder = new ChatContextBuilder(this.backlog, this.config.context_days);
        this.agent_config = {
            instruction: instruction_status.value,
            ttl_ms: this.config.context_days * 24 * 60 * 60 * 1000,
            inactivity_timeout_ms: 0,
            tool_calls_limit: 12,
            output_format: "json",
        };
        this.tools = tools;

        return Expected.ok(undefined);
    }

    // Queue message for processing in proceed()
    // NOTE: this function must NOT be async, it should return immediately
    on_new_message(message: ChatMessage): void {
        this.journal.log().info(`new managers chat message: ${message.text}`);
        this.new_messages_queue.push(message);
    }

    async proceed(): Promise<Status> {
        if (!this.context_builder || !this.agent_config || !this.tools) {
            return Expected.err("ManagersAgent is not initialized");
        }
        while (this.new_messages_queue.length > 0) {
            const message = this.new_messages_queue.shift();
            if (!message) {
                break;
            }
            if (!this.is_bot_mentioned(message.text)) {
                continue;
            }
            const context = await this.context_builder.get_context();
            if (!context.ok) {
                this.new_messages_queue.unshift(message);
                return context.wrap_error("failed to prepare managers chat context");
            }
            const status = await this.handle_message([
                ...context.value.originals,
                ...context.value.window,
            ]);
            if (!status.ok) {
                this.journal.log().error(`Failed to handle managers chat message: ${status.error}`);
            }
            break; // handle one bot's message at a time
        }

        while (true) {
            const event = await this.task_tracker_subscription.poll();
            if (!event.ok) {
                return event.wrap_error("failed to poll task tracker events").as_status();
            }
            if (!event.value) {
                return Expected.ok(undefined);
            }

            const status = await this.on_task_tracker_event(event.value);
            if (!status.ok) {
                return status.wrap_error("failed to handle task tracker event");
            }
        }
    }

    private async handle_message(context: ChatMessage[]): Promise<Status> {
        if (!this.agent_config || !this.tools) {
            return Expected.err("ManagersAgent is not initialized");
        }

        const agent = new Agent(
            this.agent_config,
            OpenaiAPI.get_llm(this.config.model),
            this.tools,
            this.journal,
        );
        const loaded_at = new Date(Date.now());
        for (const message of context) {
            agent.add_context_message(await this.to_context_message(message), loaded_at);
        }

        return await this.with_typing_indicator(async () => {
            this.journal.log().info("Requesting managers agent response");
            const response = await agent.generate_response();
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

    private async on_task_tracker_event(event: TaskTrackerEvent): Promise<Status> {
        const message = render_task_tracker_event(event, new Date());
        const sent = await this.publish_message(message);
        if (!sent.ok) {
            return sent.wrap_error("failed to publish task tracker event").as_status();
        }
        return Expected.ok(undefined);
    }

    private async to_context_message(message: ChatMessage): Promise<Message> {
        const author = this.format_author(message);
        const reply_to = typeof message.reply_to === "string"
            ? [`reply_to: ${message.reply_to}`]
            : [];
        return {
            role: this.is_bot_message(message) ? "assistant" : "user",
            content: [
                `id: ${message.message_id}`,
                `time: ${format_message_time(message.time)}`,
                `user_id: ${message.sender_id}`,
                `name: ${author}`,
                ...reply_to,
                "text:",
                message.text,
            ].join("\n"),
        };
    }

    private format_author(message: ChatMessage): string {
        if (this.is_bot_message(message)) {
            return "Ursa Major Bot";
        }

        const resolved = this.users.resolve_user({
            system_id: message.sender_id,
        });
        if (!resolved.ok || !resolved.value) {
            return `@${message.sender_id}`;
        }

        const user = resolved.value;
        const name = [user.name, user.surname]
            .filter(part => part.length > 0)
            .join(" ");
        return name.length > 0 ? name : `(unknown)`;
    }

    private is_bot_message(message: ChatMessage): boolean {
        return message.sender_id === this.dependencies.bot_id;
    }

    private async publish_message(html_text: string): Promise<Expected<string>> {
        const managers_chat = await this.dependencies.get_managers_chat();
        if (!managers_chat) {
            return Expected.err("Managers chat sender is not available");
        }

        const sent = await managers_chat.send_message(html_text);
        if (!sent.ok) {
            return sent.wrap_error("failed to send message to managers chat");
        }

        const outgoing: ChatMessage = {
            time: new Date(),
            message_id: sent.value,
            sender_id: this.dependencies.bot_id,
            text: html_text,
            reply_to: null,
        };
        await save_message(this.backlog, outgoing, "add", this.journal);
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
