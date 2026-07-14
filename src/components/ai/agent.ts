import { ILLM, IToolchain, Message, ToolsOption } from "@src/interfaces/llm.js";
import { Expected, Status } from "@src/utils/expected.js";
import { Journal } from "@src/journal.js";

type ContextItem = {
    time: Date;
    message: Message;
    retention: "persistent" | "temporary" | "ttl";
}

export type AgentCfg = {
    instruction: string;
    ttl_ms: number;
    inactivity_timeout_ms: number;
    tool_calls_limit: number;
    output_format: "text" | "json";
}

const TOOLS_LIMIT_REACHED_MESSAGE =
    "Tools usage limit is reached, provide a response based on what you have.";

function add_toolchain_to_context(context: ContextItem[], tools: IToolchain): void {
    context.push({
        time: new Date(),
        message: {
            role: "system",
            content: tools.get_readme(),
        },
        retention: "persistent",
    });

    const tools_list: string[] = ["## Available tools"];
    for (const tool of tools.get_tools().values()) {
        tools_list.push([
            `### ${tool.name}\n`,
            tool.description,
        ].join("\n"));
    }

    context.push({
        time: new Date(),
        message: {
            role: "system",
            content: tools_list.join("\n"),
        },
        retention: "persistent",
    });
}

export class Agent {
    private static next_agent_id = 1;

    private journal: Journal;
    private context: ContextItem[] = [];
    private last_activity?: Date;

    private busy: boolean = false;

    public static get_next_agent_id(): number {
        return Agent.next_agent_id++;
    }

    constructor(
        cfg: AgentCfg,
        private llm: ILLM,
        parent_journal: Journal,
        private tools?: IToolchain
    ) {
        if (cfg.tool_calls_limit <= 0) {
            throw new Error("tool_calls_limit must be positive");
        }

        const agent_id = Agent.get_next_agent_id();
        this.journal = parent_journal.child(`agent.${agent_id}`);
        this.cfg = cfg;

        this.context.push({
            time: new Date(),
            message: {
                role: "system",
                content: cfg.instruction,
            },
            retention: "persistent",
        });

        if (tools !== undefined) {
            add_toolchain_to_context(this.context, tools);
        }
    }

    private cfg: AgentCfg;

    add_user_messages(messages: Message[], time?: Date): void {
        for (const message of messages) {
            this.add_context_message(message, time);
        }
    }

    add_assistant_message(content: string, time?: Date): void {
        this.add_context_message({
            role: "assistant",
            content,
        }, time);
    }

    add_context_message(message: Message, time: Date = new Date()): void {
        this.append_ttl_message(message, time);
    }

    async generate_response(): Promise<Expected<string>> {
        if (this.busy) {
            return Expected.err("agent is still processing previous request");
        }

        this.busy = true;
        try {
            return await this.generate_response_impl();
        } finally {
            this.busy = false;
        }
    }

    private async generate_response_impl(): Promise<Expected<string>> {
        this.cleanup_context();
        this.last_activity = new Date();

        this.journal.log().info(
            `generating response with ${this.get_context_messages().length} context length`);

        for (let i = 0; i <= this.cfg.tool_calls_limit; i++) {
            const tools_limit_reached = i === this.cfg.tool_calls_limit;

            const context = this.get_context_messages();
            if (tools_limit_reached) {
                context.push({
                    role: "system",
                    content: TOOLS_LIMIT_REACHED_MESSAGE,
                });
            }

            const tools_option = this.tools !== undefined
                ? {
                    toolchain: this.tools,
                    choice: tools_limit_reached ? "none" : "auto",
                } as ToolsOption
                : undefined;

            const response = await this.llm.generate_response(
                context,
                tools_option,
                this.cfg.output_format,
            );
            if (!response.ok) {
                return response.wrap_error("failed to generate response");
            }

            const response_messages = response.value.messages;
            const appended = await this.handle_llm_response(response_messages);
            if (!appended.ok) {
                return appended.wrap_error("failed to handle LLM response");
            }

            const has_assistant = response_messages.some(m => m.role === "assistant");
            if (has_assistant && response.value.content !== null) {
                this.journal.log().info(
                    `assistant response after ${i} iterations: ${response.value.content}`);
                return Expected.ok(response.value.content);
            }
        }

        return Expected.err("tool calls limit reached without assistant response");
    }

    private get_context_messages(): Message[] {
        return this.context.map(item => item.message);
    }

    private async handle_llm_response(messages: Message[]): Promise<Status> {
        try {
            for (const message of messages) {
                this.append_ttl_message(message, new Date());
                if (message.role === "tool_calls") {
                    await this.do_tool_calls(message);
                }
            }
        } catch (e) {
            return Expected.exception("got an exception", e);
        }
        return Expected.ok(undefined);
    }

    private async do_tool_calls(
        message: Extract<Message, { role: "tool_calls" }>
    ): Promise<void>
    {
        for (const call of message.calls) {
            let result_text: string;

            try {
                if (this.tools === undefined) {
                    result_text = "Tool execution has failed! Reason: no tools are available.";
                    this.journal.log().error({ tool: call.name, parameters: call.parameters }, result_text);
                } else {
                    const result = await this.tools.call_tool(call.name, call.parameters);
                    result_text = result.ok
                        ? result.value
                        : `Tool execution has failed! Reason: ${result.error}`;
                }
            } catch (e) {
                const error_text = e instanceof Error ? e.message : String(e);
                result_text = `Tool execution has failed! Reason: ${error_text}`;
                this.journal.log().error(
                    { tool: call.name, parameters: call.parameters, error: error_text },
                    `tool '${call.name}' threw an exception`,
                );
            }

            this.append_ttl_message({
                role: "tool_result",
                tool_call_id: call.tool_call_id,
                name: call.name,
                result: result_text,
            }, new Date());
        }
    }

    private cleanup_context(): void {
        const now = Date.now();
        if (this.cfg.inactivity_timeout_ms > 0 && this.last_activity !== undefined) {
            const time_since_last_activity = now - this.last_activity.getTime();
            if (time_since_last_activity > this.cfg.inactivity_timeout_ms) {
                this.context = this.context.filter(item => item.retention === "persistent");
                this.last_activity = undefined;
                return;
            }
        }

        this.context = this.context.filter(item => {
            if (item.retention === "temporary") {
                return false;
            }
            if (item.retention === "persistent") {
                return true;
            }
            return (now - item.time.getTime()) < this.cfg.ttl_ms;
        });
    }

    private append_ttl_message(message: Message, time: Date): void {
        if (message.role !== "tool_result") {
            this.context.push({
                time,
                message,
                retention: "ttl",
            });
        } else {
            // Special case: tool results must be placed in context right
            // after the tool call that produced them. If several results
            // belong to the same tool_calls block, preserve their order.
            for (let i = this.context.length - 1; i >= 0; i--) {
                const item = this.context[i];
                if (item.message.role !== "tool_calls") {
                    continue;
                }
                if (!item.message.calls.some(call => call.tool_call_id === message.tool_call_id)) {
                    continue;
                }

                let insert_at = i + 1;
                while (insert_at < this.context.length) {
                    const next = this.context[insert_at];
                    if (next.message.role !== "tool_result") {
                        break;
                    }
                    insert_at++;
                }

                this.context.splice(insert_at, 0, {
                    time,
                    message,
                    retention: "ttl",
                });
                return;
            }

            // Fallback for malformed/internal states: append instead of
            // silently dropping the tool result.
            this.context.push({
                time,
                message,
                retention: "ttl",
            });
        }
    }
}
