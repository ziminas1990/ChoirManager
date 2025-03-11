import { StatusWith, Status } from "../../status.js";
import { DocumentsFetcher } from "../fetchers/document_fetcher.js";
import { Assistant, AssistantThread } from "../api/openai_assistant.js";
import { ChatWithHistory } from "../api/openai.js";
import { Config } from "../config.js";
import { Runtime } from "../runtime.js";
import { Scores } from "../database.js";
import pino from "pino";
import { return_fail } from "../utils.js";

const fails_instruction = `
You are a friendly counsellor for choristers. But bot didn't manage to download the document,
so you can't provide any information right now.
For all other questions, give a polite or joking refusal.
Try to use informal and joking language.
`

const instruction = `
You are a friendly counsellor for choristers. Always speak in a warm tone and never end your response with an extra question.

IMPORTANT: complaints are NOT supported in this version. If user tries to complain, politely refuse the request and say that cimplaints will be added later.

Output MUST be a valid JSON object of type 'Response' according to the following type definition:

type Response = {
    message?: string;
    actions: Action[];
}

type Action =
  | { what: "download_scores", filename: string }
  | { what: "scores_list" }
  | { what: "get_deposit_info" }
  | { what: "complaint", message: string, who?: string, voice?: "alto" | "soprano" | "bass" | "tenor" | "baritone" };

Use 'message' field to provide a message to the user. If you return an action, omit the message field.
Do NOT end your messages with an offer to answer more questions or your readiness to help with other questions.
Use the same language in which the question was asked.
Если общение идёт на русском, обращайся на "ты".

Use 'actions' field to provide a list of actions to be done. It MUST be an array of Action objects.

Action MUST have a 'what' field with one of the following values:
  - "download_scores": use when user requests specific scores (filename array must be non-empty)
  - "scores_list": use when user asks for scores without specifying which ones
  - "get_deposit_info": use when user asks about deposit/membership/money info
  - "complaint": use for complaints

More details about each action will be provided below.

## download_scores
Action MUST be emitted if user requrested specific scores. "what" field MUST be "download_scores".
"filename" field MUST be a non-empty string that contains scores file name.
User may ask to download scores by it's name, or hint, or author. Look thorugh the list
of scores above and fine the most relevant score. Use 'file' column to fill "filename"
field of the action.

%%scores%%

If you can't figure out which file is requested, emit "scores_list" action instead.

## scores_list
Action MUST be emitted if user asks to download scores without specifying which ones.

## get_deposit_info
Action MUST be emitted if user asks about deposit/membership/money info.

## complaint
If user is trying to complain OR want to report something follow the following steps:
1. Confirm if the complaint should be forwarded to the org group (орг. группе)
2. If no any details are provided, ask for any details.
3. Clarify if user wants to report anonymously or may provide name and/or voice.
4. Once clarified, output a complaint action without a message field.

Use 'who' field to specify the name of the person who is complaining. If name is not provided,
omit the 'who' field.
Use 'voice' field to specify the voice of the person who is complaining. If voice is not provided,
omit the 'voice' field. Use ONLY values specified in type definition.

## Other questions
You are allowed to provide consultation about choir music, composers and so on.
Politely refuse to answer any other questions.
`

export type Response = {
    message?: string;
    actions?: Action[];
}

export type Action =
  | { what: "download_scores", filename: string }
  | { what: "scores_list" }
  | { what: "get_deposit_info" }
  | {
        what: "complaint",
        message: string, who?: string,
        voice?: "alto" | "soprano" | "bass" | "tenor" | "baritone"
    };

abstract class IAssistant {
    abstract send_message(message: string): Promise<StatusWith<Response[]>>;
}

export class ChoristerAssistant {
    private static instance: ChoristerAssistant;

    static init(documents_fetcher: DocumentsFetcher, logger: pino.Logger) {
        if (!ChoristerAssistant.instance) {
            ChoristerAssistant.instance = new ChoristerAssistant(documents_fetcher, logger);
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
        private readonly logger: pino.Logger)
    {
        if (Config.Assistant().openai_api === "assistant") {
            ModernAssistant.init(this.get_instructions(), "json");
        }
    }

    public async send_message(username: string, message: string): Promise<StatusWith<Response[]>> {
        try {
            const status = await this.get_or_create_api(username);
            if (!status.ok()) {
                return status.wrap("can't get api for user");
            }
            const assistant = status.value!;
            return assistant.send_message(message);
        } catch (e) {
            return Status.exception(e);
        }
    }

    private async get_or_create_api(username: string): Promise<StatusWith<IAssistant>> {
        let user = this.users.get(username);
        if (user) {
            return Status.ok().with(user);
        }

        if (Config.Assistant().openai_api === "vanilla") {
            user = new VanillaAssistant(this.get_instructions(), this.logger, "json");
        } else if (Config.Assistant().openai_api === "assistant") {
            user = new ModernAssistant();
        } else {
            return return_fail("unknown assistant type", this.logger);
        }
        this.users.set(username, user);
        return Status.ok().with(user);
    }

    private get_instructions(): string {
        const faq = this.documents_fetcher.get_faq_document();
        if (!faq.ok()) {
            return fails_instruction;
        }

        const message = [
            instruction.replace("%%scores%%", this.get_scores_table_csv())
        ].join("\n\n");

        this.logger.debug("assistant instructions:\n", message);
        return message;
    }

    private get_scores_table_csv(): string {
        const runtime = Runtime.get_instance();
        const scores = runtime.get_database().all_scores();

        const table: string[] = [
            Scores.csv_header()
        ];
        for (const score of scores) {
            if (score.file) {
                table.push(score.to_csv());
            }
        }
        return table.join("\n");
    }
}

class VanillaAssistant implements IAssistant {
    private chat: ChatWithHistory;

    constructor(instructions: string,
        private readonly logger: pino.Logger,
        private response_format: "text" | "json" = "text")
    {
        const model = Config.Assistant().model;
        this.chat = new ChatWithHistory(model, this.response_format, this.logger);
        this.chat.set_system_message(instructions);
    }

    public async send_message(message: string): Promise<StatusWith<Response[]>> {
        const send_status = await this.chat.send_message(message);
        if (!send_status.ok()) {
            return send_status.wrap("vanilla: failed to send message");
        }
        const response = send_status.value!;
        const response_obj: Response = JSON.parse(response);
        return Status.ok().with([response_obj]);
    }
}

// Modern assistant uses Assistant API
class ModernAssistant implements IAssistant {
    private static assistant: Assistant;

    private thread?: AssistantThread;

    static init(instructions: string, response_format: "text" | "json" = "text") {
        const model = Config.Assistant().model;
        if (!ModernAssistant.assistant) {
            ModernAssistant.assistant = new Assistant("chorister_assistant");
            ModernAssistant.assistant.init(model, instructions, response_format);
        } else {
            throw new Error("ModernAssistant is already initialized");
        }
    }

    public async send_message(message: string): Promise<StatusWith<Response[]>> {
        if (!this.thread) {
            const status = await this.new_thread();
            if (!status.ok()) {
                return status.wrap("modern: failed to create thread");
            }
            this.thread = status.value!;
        }
        const status = await this.thread.send_message(message);
        if (!status.ok()) {
            return status.wrap("modern: failed to send message");
        }
        const response = status.value!;
        const response_obj: Response[] = response.map(r => JSON.parse(r));
        return Status.ok().with(response_obj);
    }

    static get_api(): Assistant {
        if (!ModernAssistant.assistant) {
            throw new Error("ModernAssistant is not initialized");
        }
        return ModernAssistant.assistant;
    }

    public async new_thread(): Promise<StatusWith<AssistantThread>> {
        return await ModernAssistant.assistant.create_thread();
    }
}

