import fs from "fs";

import { FeedbackStorageConfig, FeedbackStorageFactory } from "@src/adapters/feedback_storage/factory.js";
import { MessagesStorageConfig, MessagesStorageFactory } from "@src/adapters/messages_storage/factory.js";
import { RehersalsStorageConfig, RehersalsStorageFactory } from "@src/adapters/rehersals_storage/factory.js";
import {
    TaskTrackerServiceConfig,
    TaskTrackerServiceConfigJson,
} from "@src/adapters/task_tracker_service/factory.js";
import {
    SimpleMemoryServiceConfig,
    SimpleMemoryServiceConfigJson,
} from "@src/adapters/simple_memory_service/factory.js";
import {
    DepositServiceConfig,
    DepositServiceConfigJson,
} from "@src/adapters/deposit_service/factory.js";
import {
    ScoresServiceConfig,
    ScoresServiceConfigJson,
} from "@src/adapters/scores_service/factory.js";
import { AttendanceTrackerConfig, AttendanceTrackerConfigJson } from "@src/logic/attendance_tracker.js";
import { RehersalsTrackerConfig, RehersalsTrackerConfigJson } from "@src/logic/rehersals_tracker.js";
import { UserServiceConfig, UserServiceConfigJson } from "@src/adapters/user_service/factory.js";
import {
    PlainCollectionConfig,
    PlainCollectionFactory,
} from "@src/adapters/plain_collection/factory.js";
import { RuntimeConfig } from "@src/runtime.js";
import { Expected, Status } from "@src/utils/expected.js";
import { Formatting } from "@src/utils.js";

export type TgAdapterConfigJson = {
    token_file: string;
    formatting: Formatting;
    bot_id?: string;
    users_storage: PlainCollectionConfig;
}

export class TgAdapterConfig {
    constructor(private readonly json: TgAdapterConfigJson) {}

    get token_file(): string {
        return this.json.token_file;
    }

    get formatting(): Formatting {
        return this.json.formatting;
    }

    get bot_id(): string | undefined {
        return this.json.bot_id;
    }

    get users_storage(): PlainCollectionConfig {
        return this.json.users_storage;
    }

    verify(): Status {
        if (!this.json.token_file) {
            return Expected.err("'token_file' MUST be specified");
        }
        if (!this.json.formatting || !["markdown", "html", "plain"].includes(this.json.formatting)) {
            return Expected.err("'formatting' MUST be specified (markdown, html, plain)");
        }
        if (!this.json.users_storage) {
            return Expected.err("'users_storage' MUST be specified");
        }
        const storage_status = PlainCollectionFactory.verify(this.json.users_storage);
        if (!storage_status.ok) {
            return storage_status.wrap_error("'users_storage' misconfiguration");
        }
        return Expected.ok(undefined);
    }
}

export type NewRecordsTrackerTableConfigJson = {
    google_sheet_id: string;
    sheet: string;
    name: string;
    key_column: number;
}

export type NewRecordsTrackerConfigJson = {
    fetch_interval_sec: number;
    tables: NewRecordsTrackerTableConfigJson[];
}

export class NewRecordsTrackerConfig {
    constructor(private readonly json: NewRecordsTrackerConfigJson) {}

    get fetch_interval_sec(): number {
        return this.json.fetch_interval_sec;
    }

    get tables(): NewRecordsTrackerTableConfigJson[] {
        return this.json.tables ?? [];
    }

    verify(): Status {
        if (!this.json.fetch_interval_sec) {
            return Expected.err("'fetch_interval_sec' MUST be specified");
        }
        if (this.json.fetch_interval_sec < 10) {
            return Expected.err("'fetch_interval_sec' MUST be at least 10 seconds");
        }
        if (this.tables.length === 0) {
            return Expected.err("'tables' MUST contain at least one table");
        }
        for (const table of this.tables) {
            if (!table.google_sheet_id) {
                return Expected.err("'tables[].google_sheet_id' MUST be specified");
            }
            if (!table.sheet) {
                return Expected.err("'tables[].sheet' MUST be specified");
            }
            if (!table.name) {
                return Expected.err("'tables[].name' MUST be specified");
            }
            if (table.key_column == undefined) {
                return Expected.err("'tables[].key_column' MUST be specified");
            }
            if (!Number.isInteger(table.key_column) || table.key_column < 1) {
                return Expected.err("'tables[].key_column' MUST be a positive integer");
            }
        }
        return Expected.ok(undefined);
    }
}

export type ChatConfigJson = {
    backlog?: MessagesStorageConfig;
}

const DEFAULT_CHORISTER_PROMPT_FILE = "./config/prompts/chorister_agent.md";

export type AssistantConfigJson = {
    model: string;
    prompt_file?: string;
}

export class AssistantConfig {
    constructor(private readonly json: AssistantConfigJson) {}

    get model(): string {
        return this.json.model;
    }

    get prompt_file(): string {
        return this.json.prompt_file ?? DEFAULT_CHORISTER_PROMPT_FILE;
    }

    verify(): Status {
        const fail_prefix = "assistant misconfiguration";

        if (!this.json.model) {
            return Expected.err(`${fail_prefix}: 'model' MUST be specified`);
        }
        if (!fs.existsSync(this.prompt_file)) {
            return Expected.err(`${fail_prefix}: 'prompt_file' does not exist: ${this.prompt_file}`);
        }
        return Expected.ok(undefined);
    }
}

export type ManagersChatAgentConfigJson = {
    model: string;
    context_days: number;
    prompt_file: string;
}

export class ManagersChatAgentConfig {
    constructor(private readonly json: ManagersChatAgentConfigJson) {}

    get model(): string {
        return this.json.model;
    }

    get context_days(): number {
        return this.json.context_days;
    }

    get prompt_file(): string {
        return this.json.prompt_file;
    }

    verify(): Status {
        if (!this.json.model) {
            return Expected.err("'model' MUST be specified");
        }
        if (!Number.isInteger(this.json.context_days) || this.json.context_days <= 0) {
            return Expected.err("'context_days' MUST be a positive integer");
        }
        if (!this.json.prompt_file) {
            return Expected.err("'prompt_file' MUST be specified");
        }
        if (!fs.existsSync(this.json.prompt_file)) {
            return Expected.err(`'prompt_file' does not exist: ${this.json.prompt_file}`);
        }
        return Expected.ok(undefined);
    }
}

export type MessagesProviderConfigJson = {
    sheet_id: string;
    table_name: string;
}

export class MessagesProviderConfig {
    constructor(private readonly json: MessagesProviderConfigJson) {}

    get sheet_id(): string {
        return this.json.sheet_id;
    }

    get table_name(): string {
        return this.json.table_name;
    }

    verify(): Status {
        if (!this.json.sheet_id) {
            return Expected.err("'sheet_id' MUST be specified");
        }
        if (!this.json.table_name) {
            return Expected.err("'table_name' MUST be specified");
        }
        return Expected.ok(undefined);
    }
}

export type BotConfigJson = {
    runtime_cache_filename: string;
    google_cloud_key_file: string;
    runtime_dump_interval_sec: number;
    openai_api_key_file?: string;
    logs_file: string;
    tg_adapter: TgAdapterConfigJson;
    user_service: UserServiceConfigJson;
    messages_provider: MessagesProviderConfigJson;
    scores_service?: ScoresServiceConfigJson;
    new_records_tracker?: NewRecordsTrackerConfigJson;
    deposit_service?: DepositServiceConfigJson;
    attendance_tracker?: AttendanceTrackerConfigJson;
    rehersals_tracker?: RehersalsTrackerConfigJson;
    assistant?: AssistantConfigJson;
    feedback_storage?: FeedbackStorageConfig;
    rehersals_storage?: RehersalsStorageConfig;
    managers_chat?: ChatConfigJson;
    managers_chat_agent?: ManagersChatAgentConfigJson;
    announce_chat?: ChatConfigJson;
    task_tracker?: TaskTrackerServiceConfigJson;
    simple_memory: SimpleMemoryServiceConfigJson;
}

export class BotConfig {
    public readonly runtime: RuntimeConfig;
    public readonly tg_adapter?: TgAdapterConfig;
    public readonly user_service?: UserServiceConfig;
    public readonly messages_provider?: MessagesProviderConfig;
    public readonly scores_service?: ScoresServiceConfig;
    public readonly new_records_tracker?: NewRecordsTrackerConfig;
    public readonly deposit_service?: DepositServiceConfig;
    public readonly attendance_tracker?: AttendanceTrackerConfig;
    public readonly rehersals_tracker?: RehersalsTrackerConfig;
    public readonly assistant?: AssistantConfig;
    public readonly task_tracker?: TaskTrackerServiceConfig;
    public readonly simple_memory: SimpleMemoryServiceConfig;
    public readonly managers_chat_agent?: ManagersChatAgentConfig;

    constructor(public readonly json: BotConfigJson) {
        this.runtime = new RuntimeConfig({
            runtime_cache_filename: json.runtime_cache_filename,
            runtime_dump_interval_sec: json.runtime_dump_interval_sec,
            logs_file: json.logs_file,
        });

        if (json.tg_adapter != undefined) {
            this.tg_adapter = new TgAdapterConfig(json.tg_adapter);
        }
        if (json.user_service != undefined) {
            this.user_service = new UserServiceConfig(json.user_service);
        }
        if (json.messages_provider != undefined) {
            this.messages_provider = new MessagesProviderConfig(json.messages_provider);
        }
        if (json.scores_service != undefined) {
            this.scores_service = new ScoresServiceConfig(json.scores_service);
        }
        if (json.new_records_tracker != undefined) {
            this.new_records_tracker = new NewRecordsTrackerConfig(json.new_records_tracker);
        }
        if (json.deposit_service != undefined) {
            this.deposit_service = new DepositServiceConfig(json.deposit_service);
        }
        if (json.attendance_tracker != undefined) {
            this.attendance_tracker = new AttendanceTrackerConfig(json.attendance_tracker);
        }
        if (json.rehersals_tracker != undefined) {
            this.rehersals_tracker = new RehersalsTrackerConfig(json.rehersals_tracker);
        }
        if (json.assistant != undefined) {
            this.assistant = new AssistantConfig(json.assistant);
        }
        if (json.task_tracker != undefined) {
            this.task_tracker = new TaskTrackerServiceConfig(json.task_tracker);
        }
        this.simple_memory = new SimpleMemoryServiceConfig(json.simple_memory);
        if (json.managers_chat_agent != undefined) {
            this.managers_chat_agent = new ManagersChatAgentConfig(json.managers_chat_agent);
        }
    }

    verify(): Status {
        if (!this.json) {
            return Expected.err("configuration MUST be specified");
        }

        if (!this.json.google_cloud_key_file) {
            return Expected.err("'google_cloud_key_file' MUST be specified");
        }

        if (!this.tg_adapter) {
            return Expected.err("'tg_adapter' MUST be specified");
        }
        let status = this.tg_adapter.verify();
        if (!status.ok) {
            return status.wrap_error("'tg_adapter' misconfiguration");
        }

        status = this.runtime.verify();
        if (!status.ok) {
            return status.wrap_error("runtime misconfiguration");
        }

        if (!this.user_service) {
            return Expected.err("'user_service' MUST be specified");
        }
        status = this.user_service.verify();
        if (!status.ok) {
            return status.wrap_error("'user_service' misconfiguration");
        }

        if (!this.messages_provider) {
            return Expected.err("'messages_provider' MUST be specified");
        }
        status = this.messages_provider.verify();
        if (!status.ok) {
            return status.wrap_error("'messages_provider' misconfiguration");
        }

        if (this.scores_service) {
            status = this.scores_service.verify();
            if (!status.ok) {
                return status.wrap_error("'scores_service' misconfiguration");
            }
        } else {
            console.warn("'scores_service' is not specifed, feature will be DISABLED");
        }

        if (this.new_records_tracker) {
            status = this.new_records_tracker.verify();
            if (!status.ok) {
                return status.wrap_error("'new_records_tracker' misconfiguration");
            }
        }

        if (this.deposit_service) {
            status = this.deposit_service.verify();
            if (!status.ok) {
                return status.wrap_error("'deposit_service' misconfiguration");
            }
        } else {
            console.warn("'deposit_service' is not specifed, feature will be DISABLED");
        }

        if (this.assistant) {
            status = this.assistant.verify();
            if (!status.ok) {
                return status;
            }
        } else {
            console.warn("'assistant' is not specifed, feature will be DISABLED");
        }

        if (this.assistant && !this.json.openai_api_key_file) {
            console.warn(
                "'assistant' is specifed, but 'openai_api_key_file' is not specifed, feature will be DISABLED"
            );
        }

        if (this.json.feedback_storage) {
            status = FeedbackStorageFactory.verify(this.json.feedback_storage);
            if (!status.ok) {
                return status.wrap_error("feedback_storage misconfiguration");
            }
        }

        if (this.json.rehersals_storage) {
            status = RehersalsStorageFactory.verify(this.json.rehersals_storage);
            if (!status.ok) {
                return status.wrap_error("rehersals_storage misconfiguration");
            }
        }

        if (this.rehersals_tracker) {
            if (!this.json.rehersals_storage) {
                return Expected.err("'rehersals_tracker' is specified, but 'rehersals_storage' is not specified");
            }
            status = this.rehersals_tracker.verify();
            if (!status.ok) {
                return status.wrap_error("'rehersals_tracker' misconfiguration");
            }
        }

        if (this.attendance_tracker) {
            if (!this.json.rehersals_storage) {
                return Expected.err("'attendance_tracker' is specified, but 'rehersals_storage' is not specified");
            }
            if (!this.rehersals_tracker) {
                return Expected.err("'attendance_tracker' is specified, but 'rehersals_tracker' is not specified");
            }
            status = this.attendance_tracker.verify();
            if (!status.ok) {
                return status.wrap_error("'attendance_tracker' misconfiguration");
            }
        }

        if (this.task_tracker) {
            status = this.task_tracker.verify();
            if (!status.ok) {
                return status.wrap_error("'task_tracker' misconfiguration");
            }
        }

        if (!this.json.simple_memory) {
            return Expected.err("'simple_memory' MUST be specified");
        }
        status = this.simple_memory.verify();
        if (!status.ok) {
            return status.wrap_error("'simple_memory' misconfiguration");
        }
        if (!this.json.openai_api_key_file) {
            return Expected.err(
                "'simple_memory' is specified, but 'openai_api_key_file' is not specified"
            );
        }

        if (this.managers_chat_agent) {
            status = this.managers_chat_agent.verify();
            if (!status.ok) {
                return status.wrap_error("'managers_chat_agent' misconfiguration");
            }
            if (!this.json.openai_api_key_file) {
                return Expected.err(
                    "'managers_chat_agent' is specified, but 'openai_api_key_file' is not specified"
                );
            }
            if (!this.json.managers_chat?.backlog) {
                return Expected.err(
                    "'managers_chat_agent' is specified, but 'managers_chat.backlog' is not specified"
                );
            }
            if (!this.json.tg_adapter?.bot_id) {
                return Expected.err(
                    "'managers_chat_agent' is specified, but 'tg_adapter.bot_id' is not specified"
                );
            }
        }

        if (this.json.managers_chat?.backlog) {
            status = MessagesStorageFactory.verify(this.json.managers_chat.backlog);
            if (!status.ok) {
                return status.wrap_error("managers_chat_backlog misconfiguration");
            }
        }

        if (this.json.announce_chat?.backlog) {
            status = MessagesStorageFactory.verify(this.json.announce_chat.backlog);
            if (!status.ok) {
                return status.wrap_error("announce_chat_backlog misconfiguration");
            }
        }

        return Expected.ok(undefined);
    }
}

export function load_config(path: string): Expected<BotConfig> {
    try {
        const json = JSON.parse(fs.readFileSync(path, "utf-8")) as BotConfigJson;
        const config = new BotConfig(json);
        const status = config.verify();
        if (!status.ok) {
            return Expected.err("Invalid configuration", status);
        }
        return Expected.ok(config);
    } catch (error) {
        return Expected.exception("Failed to load configuration", error);
    }
}

export class Config {
    public static data: BotConfigJson;
    private static current?: BotConfig;

    static Load(path: string): Status {
        const status = load_config(path);
        if (!status.ok) {
            return status.as_status();
        }
        this.current = status.value;
        this.data = status.value.json;
        return Expected.ok(undefined);
    }

    static HasTgAdapter(): boolean {
        return this.current_config().tg_adapter != undefined;
    }

    static HasOpenAI(): boolean {
        return this.data.openai_api_key_file != undefined;
    }

    static HasAssistant(): boolean {
        return this.current_config().assistant != undefined;
    }

    static HasScoresService(): boolean {
        return this.current_config().scores_service != undefined;
    }

    static HasNewRecordsTracker(): boolean {
        return this.current_config().new_records_tracker != undefined;
    }

    static TgAdapter(): TgAdapterConfig {
        const cfg = this.current_config().tg_adapter;
        if (!cfg) {
            throw new Error("tg_adapter is not specified!");
        }
        return cfg;
    }

    static UserService(): UserServiceConfig {
        const cfg = this.current_config().user_service;
        if (!cfg) {
            throw new Error("user_service is not specified!");
        }
        return cfg;
    }

    static ScoresService(): ScoresServiceConfig {
        const cfg = this.current_config().scores_service;
        if (!cfg) {
            throw new Error("scores_service is not specified!");
        }
        return cfg;
    }

    static NewRecordsTracker(): NewRecordsTrackerConfig {
        const cfg = this.current_config().new_records_tracker;
        if (!cfg) {
            throw new Error("new_records_tracker is not specified!");
        }
        return cfg;
    }

    static Assistant(): AssistantConfig {
        const cfg = this.current_config().assistant;
        if (!cfg) {
            throw new Error("assistant is not specified!");
        }
        return cfg;
    }

    private static current_config(): BotConfig {
        if (!this.current) {
            throw new Error("configuration is not loaded");
        }
        return this.current;
    }
}