import { StatusWith, Status } from "@src/status.js";
import { DocumentsFetcher } from "@src/fetchers/document_fetcher.js";
import { Assistant, AssistantThread } from "@src/api/openai_assistant.js";
import { ChatWithHistory } from "@src/api/openai.js";
import { Config } from "@src/config.js";
import { Runtime } from "@src/runtime.js";
import { Scores } from "@src/database.js";
import { Journal } from "@src/journal.js";
import { return_fail } from "@src/utils.js";

const fails_instruction = `
You are a friendly counsellor for choristers. But bot didn't manage to download the document,
so you can't provide any information right now.
For all other questions, give a polite or joking refusal.
Try to use informal and joking language.
`

const instruction = `
You are a friendly counsellor for choristers. Always speak in a warm tone and never end your response with an extra question.
Output MUST be a valid JSON object of type 'Response' according to the following type definition:

type Response =
  | { what: "message", text: string }
  | { what: "download_scores", filename: string }
  | { what: "scores_list" }
  | { what: "get_deposit_info" }
  | { what: "already_paid" }
  | { what: "top_up", amount: number, original_message: string }
  | { what: "feedback", details?: string };

Action MUST have a 'what' field with one of the following values:
  - "message": use when you need to send a message to the user in order to clarify something OR to provide a response to the user
  - "download_scores": use when user requests specific scores (filename array must be non-empty)
  - "scores_list": use when user asks for scores without specifying which ones
  - "get_deposit_info": use when user asks for deposit/membership info
  - "already_paid": use when user tells that they already paid membership fee
  - "top-up": use when user says that they has deposited the money
  - "feedback": use for complaints or any feedback that chorister wants to share with the org group

More details about each action will be provided below.

## Terms
A list of terms that you may use in your responses:
- "org group": the group of people who are responsible for the choir. In russian it's called "орг. группа".

## message
Emit this action when you need to send a message to the user with any purpose.
"text" field MUST be a non-empty string that contains the message to be sent.
Do NOT end your messages with an offer to answer more questions or your readiness to help with other questions.
Use the same language in which the question was asked.
Если общение идёт на русском, обращайся на "ты".

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

## top_up
Action MUST be emitted if user says that they has deposited the money. The following fields MUST be provided:
- "amount": number of money that user has deposited. If they hadn't specified, try to clarify it.
- "original_message": original message from user that triggered this action.
Examples:
1. User: "Закинул 100 лари". Action: { what: "top_up", amount: 100, original_message: "Закинул 100 лари" }

## already_paid
Action MUST be emitted if after getting a reminder user says that they have already paid membership fee.
IMPORTANT: if user specifies the amount or previous date (yesterday, last week, etc), use "top_up" action instead.
Examples:
1. User: "Я уже пополнял". Action: { what: "already_paid" }
2. User: "I deposited 100 GEL yesterday". Action: { what: "top_up", amount: 100, original_message: "I deposited 100 GEL yesterday" }

## feedback
If user says the they wants to leave a feedback and doesn't provide any details, emit 'feedback' action WITHOUT "details" field.
If user does provide the feedback details, emit 'feedback' action and fill "details" field with the provided details.
Examples:
1. User: "I want to leave a feedback". Action: { what: "feedback" }
2. User: "Rehearsal was too long". Action: { what: "feedback", details: "Rehearsal was too long" }
3. User: "Передай что в помещении очень холодно". Action: { what: "feedback", details: "В помещении очень холодно" }

## Other questions
You are allowed to:
1. provide consultation about choir music, composers and so on.
2. speak about everything said before in the conversation.
Politely refuse to answer any other questions.
`

export type Response =
  | { what: "message", text: string }
  | { what: "download_scores", filename: string }
  | { what: "scores_list" }
  | { what: "get_deposit_info" }
  | { what: "already_paid" }
  | { what: "top_up", amount: number, original_message: string }
  | { what: "feedback", details?: string };

abstract class IAssistant {
    // Send message to assistant and waits for answer
    abstract send_message(message: string): Promise<StatusWith<Response[]>>;

    // Add message to the context as a response or notification, previously sent to the user
    abstract add_response(message: string): Promise<Status>;
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

    public async add_response(username: string, message: string): Promise<Status> {
        const status = await this.get_or_create_api(username);
        if (!status.ok()) {
            return status.wrap("can't get api for user");
        }
        const assistant = status.value!;
        return assistant.add_response(message);
    }

    private async get_or_create_api(username: string): Promise<StatusWith<IAssistant>> {
        let user = this.users.get(username);
        if (user) {
            return Status.ok().with(user);
        }

        if (Config.Assistant().openai_api === "vanilla") {
            user = new VanillaAssistant(this.get_instructions(), this.journal, "json");
        } else if (Config.Assistant().openai_api === "assistant") {
            user = new ModernAssistant(this.journal);
        } else {
            return return_fail("unknown assistant type", this.journal.log());
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

        this.journal.log().debug("assistant instructions:\n", message);
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
        private readonly journal: Journal,
        private response_format: "text" | "json" = "text")
    {
        const model = Config.Assistant().model;
        this.chat = new ChatWithHistory(model, this.response_format, this.journal);
        this.chat.set_system_message(instructions);
    }

    public async send_message(message: string): Promise<StatusWith<Response[]>> {
        const send_status = await this.chat.send_message(message, false);
        if (!send_status.ok()) {
            return send_status.wrap("vanilla: failed to send message");
        }
        const response = send_status.value!;
        const response_obj: Response = JSON.parse(response);
        if (response_obj.what === "message") {
            const add_status = await this.add_response(response_obj.text);
            if (!add_status.ok()) {
                this.journal.log().warn(`vanilla: failed to add response: ${add_status.what()}`);
            }
        }
        return Status.ok().with([response_obj]);
    }

    public async add_response(message: string): Promise<Status> {
        return this.chat.add_response(message, "bot to user");
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

    constructor(private readonly journal: Journal) {
        if (!ModernAssistant.assistant) {
            throw new Error("ModernAssistant is not initialized");
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

    public async add_response(message: string): Promise<Status> {
        if (!this.thread) {
            return return_fail("thread is not initialized", this.journal.log());
        }
        return this.thread.add_response(message, "bot to user");
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

