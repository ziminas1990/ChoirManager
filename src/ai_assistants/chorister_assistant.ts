import { Expected, Status } from "@src/utils/expected.js";
import { DocumentsFetcher } from "@src/fetchers/document_fetcher.js";
import { OpenaiAPI } from "@src/api/openai.js";
import { Config } from "@src/config.js";
import { Journal } from "@src/journal.js";
import { Agent } from "@src/components/ai/agent.js";
import { IToolchain } from "@src/interfaces/llm.js";

const fails_instruction = `
You are a friendly counsellor for choristers. But bot didn't manage to download the document,
so you can't provide any information right now.
For all other questions, give a polite or joking refusal using messanger_send_message.
Try to use informal and joking language.

After using tools, return only:
{ "status": "success" }
`

const instruction = `
You are a friendly counsellor for choristers. Always speak in a warm tone and never end your response with an extra question.
You are an agent with tools. Use tools to actually help the user: send messages, show scores, provide deposit info, register deposit events, start feedback flow, and show transaction history.

Do not return business actions as JSON. If the user needs something done, call the appropriate tool.
After all required tool calls are complete, return only a JSON object:
{ "status": "success" }
If you cannot complete the request, call messanger_send_message with a short explanation and then return:
{ "status": "error", "description": "<what went wrong>" }

## Terms
A list of terms that you may use in your responses:
- "org group": the group of people who are responsible for the choir. In russian it's called "орг. группа".

## Communication
Use messanger_send_message when you need to answer, clarify something, greet the user, or politely refuse.
Use the same language in which the question was asked. Если общение идёт на русском, обращайся на "ты".
Do NOT end your messages with an offer to answer more questions or your readiness to help with other questions.

## Scores
Use scores_get_list when the user asks for scores without a specific title.
Use scores_download when the user asks for a specific score by title, author, filename or hint. If you are unsure which score is meant, use scores_get_list.

## Deposit
Use deposit_manager_send_deposit_info when the user asks about deposit, membership fee, balance, or money info.
Use deposit_manager_already_paid when the user says they already paid but does not specify a new amount/date.
Use deposit_manager_top_up when the user says they deposited money. If the amount is missing, ask for it with messanger_send_message.
Use deposit_manager_send_transactions when the user asks for transaction history.

## Feedback
Use feedback_start when the user wants to leave feedback, complaint, or message for the org group. If the user already provided details, pass them to the tool.

## Other questions
If user just greets you, greet them back with messanger_send_message.
If user asks you something, you are allowed to:
1. tell user about functions of the bot
2. provide consultation about choir music, composers and so on
3. speak about everything said before in the conversation
Politely refuse to answer any other questions using messanger_send_message.
`

interface IAssistant {
    send_message(message: string): Promise<Status>;

    // Add a message to the context as a response or notification previously sent to the user.
    add_response(message: string): Promise<Status>;
}

export class ChoristerAssistant {
    private static instance: ChoristerAssistant;

    static init(documents_fetcher: DocumentsFetcher, journal: Journal) {
        if (!ChoristerAssistant.instance) {
            ChoristerAssistant.instance = new ChoristerAssistant(documents_fetcher, journal);
        }
    }

    static get_instance(): ChoristerAssistant {
        if (!ChoristerAssistant.instance) {
            throw new Error("ChoristerAssistant is not initialized");
        }
        return ChoristerAssistant.instance;
    }

    static is_available(): boolean {
        return this.instance != undefined;
    }

    private users: Map<string, IAssistant> = new Map();

    constructor(
        private documents_fetcher: DocumentsFetcher,
        private readonly journal: Journal)
    {}

    public async send_message(
        username: string,
        message: string,
        tools: IToolchain,
    ): Promise<Status> {
        try {
            const status = await this.get_or_create_api(username, tools);
            if (!status.ok) {
                return status.add_context("can't get api for user").wrap_error("can't get api for user");
            }
            return await status.value.send_message(message);
        } catch (e) {
            return Expected.exception("can't send message", e);
        }
    }

    public async add_response(username: string, message: string): Promise<Status> {
        const assistant = this.users.get(username);
        if (!assistant) {
            return Expected.ok(undefined);
        }
        return assistant.add_response(message);
    }

    private async get_or_create_api(
        username: string,
        tools: IToolchain,
    ): Promise<Expected<IAssistant>> {
        let user = this.users.get(username);
        if (user) {
            return Expected.ok(user);
        }

        if (!["vanilla", "assistant"].includes(Config.Assistant().openai_api)) {
            this.journal.log().error("unknown assistant type");
            return Expected.err("unknown assistant type");
        }

        user = this.create_agent_assistant(username, tools);
        this.users.set(username, user);
        return Expected.ok(user);
    }

    private create_agent_assistant(username: string, tools: IToolchain): IAssistant {
        const agent = new Agent(
            {
                instruction: this.get_instructions(),
                ttl_ms: 30 * 60 * 1000,
                inactivity_timeout_ms: 6 * 60 * 60 * 1000,
                tool_calls_limit: 5,
                output_format: "json",
            },
            OpenaiAPI.get_llm(Config.Assistant().model),
            this.journal.child(username),
            tools,
        );

        return new AgentAssistant(agent);
    }

    private get_instructions(): string {
        const faq = this.documents_fetcher.get_faq_document();
        const message = faq.ok
            ? [instruction, "## FAQ", faq.value].join("\n\n")
            : fails_instruction;

        this.journal.log().debug("assistant instructions:\n", message);
        return message;
    }
}

class AgentAssistant implements IAssistant {

    constructor(private agent: Agent) {}

    public async send_message(message: string): Promise<Status> {
        const response = await this.agent.generate_response([
            { role: "user", content: message },
        ]);
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
