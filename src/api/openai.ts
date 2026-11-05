import OpenAI from "openai";
import fs from "fs";
import { BotConfig } from "@src/config.js";
import { Expected, Status } from "@src/utils/expected.js";
import { ILLM } from "@src/interfaces/llm.js";
import { OpenaiChatCompletionsLLM } from "@src/adapters/llm/openai_chat_completions.js";
import { OpenaiResponsesLLM } from "@src/adapters/llm/openai_responses.js";
import { uses_openai_responses_api, verify_openai_model } from "./openai_models.js";

export type OpenaiModel = string;

export class OpenaiAPI {
    private static _instance: OpenAI;

    public static init(config: BotConfig): Status {
        if (!config.json.openai_api_key_file) {
            return Expected.err("OpenAI API key is not specified");
        }
        if (this._instance) {
            return Expected.err("OpenAI API is already initialized");
        }
        const api_key = fs.readFileSync(config.json.openai_api_key_file, "utf-8").trim();
        this._instance = new OpenAI({ apiKey: api_key, });
        return Expected.ok(undefined);
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

    public static get_llm(model: OpenaiModel): ILLM {
        const status = verify_openai_model(model);
        if (!status.ok) {
            throw new Error(status.error);
        }
        model = model.toLowerCase();
        const get_client = () => this.get_instance();
        if (uses_openai_responses_api(model)) {
            return new OpenaiResponsesLLM(model, get_client);
        }
        return new OpenaiChatCompletionsLLM(model, get_client);
    }
}
