import OpenAI from "openai";
import { Expected, Status } from "@src/utils/expected.js";
import { OpenaiAPI } from "./openai.js";

// NOTE: this API is not being used now, because it much slower than regular
// ChatWithHistory.

export class AssistantThread {
    private thread: OpenAI.Beta.Thread;

    constructor(thread: OpenAI.Beta.Thread, private assistant_id: string) {
        this.thread = thread;
    }

    public async send_message(message: string): Promise<Expected<string[]>> {
        const instance = OpenaiAPI.get_instance();
        if (!instance) {
            return Expected.err("OpenAI API is not initialized");
        }
        const status = await this.add_message(message, "user");
        if (!status.ok) {
            return status.cast_error<string[]>();
        }
        try {
            const run = await instance.beta.threads.runs.createAndPoll(
                this.thread.id,
                {
                    assistant_id: this.assistant_id,
                },
            );
            const messages = await instance.beta.threads.messages.list(
                this.thread.id, { run_id: run.id });

            const responses: string[] = [];
            for (const message of messages.data.reverse()) {
                const content = message.content[0];
                if (message.role == "assistant" && content.type === "text") {
                    responses.push(content.text.value);
                }
            }

            return Expected.ok(responses);
        } catch (error) {
            return (((error) instanceof Error) ? Expected.err((error).message) : Expected.err(String(error))).wrap_error("failed to run the thread");
        }
    }

    public async add_response(message: string, prefix: string = ""): Promise<Status> {
        const content = (prefix ? `[${prefix}]\n` : "") + message;
        return this.add_message(content, "assistant");
    }

    private async add_message(message: string, role: "user" | "assistant"): Promise<Status> {
        const instance = OpenaiAPI.get_instance();
        if (!instance) {
            return Expected.err("OpenAI API is not initialized");
        }
        try {
            await instance.beta.threads.messages.create(this.thread.id, {
                role,
                content: message,
            });
            return Expected.ok(undefined);
        } catch (error) {
            return (((error) instanceof Error) ? Expected.err((error).message) : Expected.err(String(error))).wrap_error("failed to add message to thread");
        }
    }
}

export class Assistant {

    private assistant?: OpenAI.Beta.Assistant;

    constructor(private name: string, private description: string | null = null) {}

    async init(
        model: "gpt-4o" | "gpt-4o-mini",
        instructions: string,
        response_format: "text" | "json",
    ): Promise<Status> {
        if (!OpenaiAPI.is_available()) {
            return Expected.err("OpenAI API is not initialized");
        }

        try {
            this.assistant = await OpenaiAPI.get_instance().beta.assistants.create({
                model: model,
                name: this.name,
                description: this.description,
                instructions: instructions,
                response_format: response_format === "json"
                    ? { type: "json_object" }
                    : undefined,
            });
            return Expected.ok(undefined);
        } catch (error) {
            return (((error) instanceof Error) ? Expected.err((error).message) : Expected.err(String(error))).wrap_error("failed to create assistant");
        }
    }

    public async create_thread(): Promise<Expected<AssistantThread>>
    {
        if (!this.assistant) {
            return Expected.err("Assistant is not initialized");
        }
        try {
            const instance = OpenaiAPI.get_instance();
            const openai_thread = await instance.beta.threads.create();
            const thread = new AssistantThread(openai_thread, this.assistant.id);
            return Expected.ok(thread);
        } catch (error) {
            return (((error) instanceof Error) ? Expected.err((error).message) : Expected.err(String(error))).wrap_error("failed to create thread");
        }
    }
}
