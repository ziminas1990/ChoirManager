import { AssistantConfig, BotConfig, BotConfigJson } from "@src/config.js";
import { RuntimeConfig } from "@src/runtime.js";

export function telegram_config() {
    return {
        runtime: new RuntimeConfig({ runtime_cache_filename: "/tmp/choir-test-runtime.json",
            runtime_dump_interval_sec: 60, logs_file: "/tmp/choir-test.log" }),
        assistant: new AssistantConfig({ model: "gpt-6.1-sol" }),
    };
}

export function bot_config(overrides: Partial<BotConfigJson> = {}): BotConfig {
    return new BotConfig({
        runtime_cache_filename: "/tmp/choir-test-runtime.json", google_cloud_key_file: "unused",
        runtime_dump_interval_sec: 60, logs_file: "/tmp/choir-test.log",
        tg_adapter: { token_file: "unused", formatting: "html", users_storage: {
            type: "google_firestore", database_id: "test", collection_name: "telegram_users" } },
        user_service: { type: "local", storage: {
            type: "google_firestore", database_id: "test", collection_name: "users" } },
        messages_provider: { sheet_id: "test", table_name: "Messages" },
        assistant: { model: "gpt-6.1-sol" },
        simple_memory: { type: "local", model: "gpt-6.1-sol",
            search_prompt_file: "config/prompts/chorister_agent.md",
            ask_prompt_file: "config/prompts/chorister_agent.md",
            storage: { type: "google_firestore", database_id: "test", collection_name: "memory" } },
        ...overrides,
    });
}
