import { Expected, Status } from "@src/utils/expected.js";
import { OpenaiAPI } from "@src/api/openai.js";
import { AssistantConfig } from "@src/fetchers/document_fetcher.js";
import { Journal } from "@src/journal.js";
import { Agent } from "@src/components/ai/agent.js";
import { IToolchain } from "@src/interfaces/llm.js";

const instruction = `
You are a friendly counsellor for choristers. Always speak in a warm tone and never end your response with an extra question.
You are an agent with tools. Use tools to actually help the user.

After all required tool calls are complete, return only a JSON object:
{ "status": "success" }
If you cannot complete the request, call messanger_send_message with a short explanation and then return:
{ "status": "error", "description": "<what went wrong>" }

## Communication
The only way to send message back to user is to call messanger_send_message tool or some other tools, that send messages to the user.
Use the same language in which the question was asked. Если общение идёт на русском, обращайся на "ты".
Do NOT end your messages with an offer to answer more questions or your readiness to help with other questions.

## Use cases

IMPORTANT RULES:
- Use cases provides a precise and clear set of instructions for the assistant to follow.
- If the user's request clearly matches one of the use cases below, follow that use case strictly in that exact order.
- If the use case does not explicitly say to send a message, do NOT call messanger_send_message.
- Do NOT add any extra steps that are not written in that use case.
- Do NOT send acknowledgements, progress updates, introductions, or summaries when the required tool already handles the user-facing response.

### Deposit use cases

If user asks about deposit, membership fee, balance, or money info:
- just call deposit_manager_send_deposit_info

If user says they already paid but does not specify a new amount/date:
- just call deposit_manager_already_paid

If user says they deposited money:
- just call deposit_manager_top_up

If user asks for transaction history:
- just call deposit_manager_send_transactions

### Scores use cases

If user asks for scores without a specific title:
- just call scores_display_list

If user asks for a specific scores by title or author, do the follow:
- immediately call messanger_send_message to send a message that says that you are looking for the score
- call scores_get_list to get a list of scores
- look through the list and choose the best match
- call scores_send_to_user to send the selected score to the user

### Feedback use cases

If user wants to leave feedback, complaint, or message for the org group:
- just call feedback_start

### Other questions use cases

If user just greets you, greet them back with messanger_send_message.

If user asks you something, you are allowed to:
1. tell user about functions of the bot
2. speak about everything said before in the conversation

Politely refuse to answer any other questions.
`

export class ChoristerAgent {
    private agent?: Agent;

    constructor(
        private readonly config: AssistantConfig,
        private readonly journal: Journal,
    ) {}

    public async send_message(
        message: string,
        tools: IToolchain,
    ): Promise<Status> {
        try {
            const agent = this.get_or_create_agent(tools);
            agent.add_user_messages([
                { role: "user", content: message },
            ]);
            const response = await agent.generate_response();
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
        if (!this.agent) {
            return Expected.ok(undefined);
        }
        this.agent.add_assistant_message(`[bot to user]\n${message}`);
        return Expected.ok(undefined);
    }

    private get_or_create_agent(tools: IToolchain): Agent {
        if (this.agent) {
            return this.agent;
        }

        this.agent = new Agent(
            {
                instruction: this.get_instructions(),
                ttl_ms: 30 * 60 * 1000,
                inactivity_timeout_ms: 6 * 60 * 60 * 1000,
                tool_calls_limit: 5,
                output_format: "json",
            },
            OpenaiAPI.get_llm(this.config.model),
            this.journal,
            tools,
        );
        return this.agent;
    }

    private get_instructions(): string {
        this.journal.log().debug("assistant instructions:\n", instruction);
        return instruction;
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
