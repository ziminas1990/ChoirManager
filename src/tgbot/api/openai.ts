import OpenAI from "openai";
import fs from "fs";
import { ChatCompletionMessageParam } from "openai/resources";
import { Config } from "../config.js";
import { Status, StatusWith } from "../../status.js";
import pino from "pino";
import { return_exception, return_fail } from "../utils.js";

export class OpenaiAPI {
    private static _instance: OpenAI;

    public static init(): Status {
        if (!Config.HasOpenAI()) {
            return Status.fail("OpenAI API key is not specified");
        }
        const api_key = fs.readFileSync(Config.data.openai_api_key_file!, "utf-8").trim();
        this._instance = new OpenAI({ apiKey: api_key, });
        return Status.ok();
    }

    public static is_available(): boolean {
        return this._instance !== undefined;
    }

    public static get_instance(): OpenAI {
        if (!this._instance) {
            throw new Error("OpenAI API is not initialized");
        }
        return this._instance;
    }
}


export class ChatWithHistory {
    private system_message?: ChatCompletionMessageParam;
    private history: ChatCompletionMessageParam[];
    private history_length_sym: number = 0;

    constructor(
        private model: "gpt-4o-mini" | "gpt-4o",
        private response_format: "text" | "json",
        private readonly logger: pino.Logger,
        private max_history_length_sym: number = 0x4000,
        private max_message_length_sym: number = 0x1000)
    {
        this.history = [];
    }

    // NOTE: This doesn't send message!
    public set_system_message(message: string) {
        this.system_message = { role: "system", content: message };
    }

    public async send_message(message: string): Promise<StatusWith<string>> {
        const instance = OpenaiAPI.get_instance();
        if (!instance) {
            return return_fail("OpenAI API is not initialized", this.logger);
        }

        if (message.length > this.max_message_length_sym) {
            return return_fail("Message is too long", this.logger);
        }

        this.push_to_history({ role: "user", content: message });

        const messages: ChatCompletionMessageParam[] = [];
        if (this.system_message) {
            messages.push(this.system_message);
        }
        messages.push(...this.history);

        try {
            this.logger.info(`sending message: ${message}`);
            const completion = await instance.chat.completions.create({
                model: this.model,
                store: true,
                messages: messages,
                response_format: this.response_format === "json"
                    ? { type: "json_object" }
                    : undefined,
            });
            this.history.push(completion.choices[0].message);
            const response = completion.choices[0].message.content;
            if (!response) {
                return return_fail("no response", this.logger);
            }
            return StatusWith.ok().with(response);
        } catch (error) {
            return return_exception(error, this.logger);
        }
    }

    private push_to_history(message: ChatCompletionMessageParam) {
        this.history.push(message);
        this.history_length_sym += message.content!.length;
        this.fit_history_to_max_length();
    }

    private fit_history_to_max_length() {
        if (this.history.length == 0) {
            return;
        }

        // Remove oldest messages until the history length is less than the max length
        while (this.history_length_sym > this.max_history_length_sym) {
            const oldest_message = this.history.shift();
            if (!oldest_message) {
                return;
            }
            const content = oldest_message!.content;
            if (!content) {
                continue;
            }
            this.history_length_sym -= content.length;
        }
    }
}