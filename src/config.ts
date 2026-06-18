import fs from "fs";

import { FeedbackStorageConfig, FeedbackStorageFactory } from "@src/adapters/feedback_storage/factory.js";
import { MessagesStorageConfig, MessagesStorageFactory } from "@src/adapters/messages_storage/factory.js";
import { RehersalsStorageConfig, RehersalsStorageFactory } from "@src/adapters/rehersals_storage/factory.js";
import { TaskTrackerDatabaseConfig, TaskTrackerFactory } from "@src/adapters/task_tracker/factory.js";
import { TransactionStorageConfig } from "@src/adapters/transactions_storage/factory.js";
import { AssistantConfig, AssistantConfigJson } from "@src/fetchers/document_fetcher.js";
import { DepositTrackingConfig, DepositTrackingConfigJson } from "@src/fetchers/deposits_fetcher.js";
import { ScoresFetcherConfig, ScoresFetcherConfigJson } from "@src/fetchers/scores_fetcher.js";
import { UsersFetcherConfig, UsersFetcherConfigJson } from "@src/fetchers/users_fetcher.js";
import { RehersalsTrackerConfig, RehersalsTrackerConfigJson } from "@src/logic/rehersals_tracker.js";
import { RuntimeConfig } from "@src/runtime.js";
import { Expected, Status } from "@src/utils/expected.js";
import { Formatting } from "@src/utils.js";

export type TgAdapterConfigJson = {
    token_file: string;
    formatting: Formatting;
    bot_id?: string;
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

    verify(): Status {
        if (!this.json.token_file) {
            return Expected.err("'token_file' MUST be specified");
        }
        if (!this.json.formatting || !["markdown", "html", "plain"].includes(this.json.formatting)) {
            return Expected.err("'formatting' MUST be specified (markdown, html, plain)");
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

export type TaskTrackerConfigJson = {
    database: TaskTrackerDatabaseConfig;
    enable_notifications: boolean;
    deadline_threshold_days: number;
    notification_time_utc: string;
}

export class TaskTrackerConfig {
    constructor(private readonly json: TaskTrackerConfigJson) {}

    get database(): TaskTrackerDatabaseConfig {
        return this.json.database;
    }

    get enable_notifications(): boolean {
        return this.json.enable_notifications;
    }

    get deadline_threshold_days(): number {
        return this.json.deadline_threshold_days;
    }

    get notification_time_utc(): { hours: number; minutes: number } {
        const [hours, minutes] = this.json.notification_time_utc.split(":").map(part => parseInt(part, 10));
        return { hours, minutes };
    }

    verify(): Status {
        if (!this.json.database) {
            return Expected.err("'database' MUST be specified");
        }
        let status = TaskTrackerFactory.verify(this.json.database);
        if (!status.ok) {
            return status.wrap_error("'database' misconfiguration");
        }

        if (typeof this.json.enable_notifications !== "boolean") {
            return Expected.err("'enable_notifications' MUST be specified");
        }

        if (!Number.isFinite(this.json.deadline_threshold_days)) {
            return Expected.err("'deadline_threshold_days' MUST be specified");
        }
        if (this.json.deadline_threshold_days < 0) {
            return Expected.err("'deadline_threshold_days' MUST be non-negative");
        }

        if (!this.json.notification_time_utc) {
            return Expected.err("'notification_time_utc' MUST be specified");
        }
        if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(this.json.notification_time_utc)) {
            return Expected.err("'notification_time_utc' MUST be in HH:MM format");
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
    users_fetcher: UsersFetcherConfigJson;
    scores_fetcher?: ScoresFetcherConfigJson;
    new_records_tracker?: NewRecordsTrackerConfigJson;
    deposit_tracking?: DepositTrackingConfigJson;
    rehersals_tracker?: RehersalsTrackerConfigJson;
    assistant?: AssistantConfigJson;
    feedback_storage?: FeedbackStorageConfig;
    transaction_storage?: TransactionStorageConfig;
    rehersals_storage?: RehersalsStorageConfig;
    managers_chat?: ChatConfigJson;
    announce_chat?: ChatConfigJson;
    task_tracker?: TaskTrackerConfigJson;
}

export class BotConfig {
    public readonly runtime: RuntimeConfig;
    public readonly tg_adapter?: TgAdapterConfig;
    public readonly users_fetcher?: UsersFetcherConfig;
    public readonly scores_fetcher?: ScoresFetcherConfig;
    public readonly new_records_tracker?: NewRecordsTrackerConfig;
    public readonly deposit_tracking?: DepositTrackingConfig;
    public readonly rehersals_tracker?: RehersalsTrackerConfig;
    public readonly assistant?: AssistantConfig;
    public readonly task_tracker?: TaskTrackerConfig;

    constructor(public readonly json: BotConfigJson) {
        this.runtime = new RuntimeConfig({
            runtime_cache_filename: json.runtime_cache_filename,
            runtime_dump_interval_sec: json.runtime_dump_interval_sec,
            logs_file: json.logs_file,
        });

        if (json.tg_adapter != undefined) {
            this.tg_adapter = new TgAdapterConfig(json.tg_adapter);
        }
        if (json.users_fetcher != undefined) {
            this.users_fetcher = new UsersFetcherConfig(json.users_fetcher);
        }
        if (json.scores_fetcher != undefined) {
            this.scores_fetcher = new ScoresFetcherConfig(json.scores_fetcher);
        }
        if (json.new_records_tracker != undefined) {
            this.new_records_tracker = new NewRecordsTrackerConfig(json.new_records_tracker);
        }
        if (json.deposit_tracking != undefined) {
            this.deposit_tracking = new DepositTrackingConfig(json.deposit_tracking);
        }
        if (json.rehersals_tracker != undefined) {
            this.rehersals_tracker = new RehersalsTrackerConfig(json.rehersals_tracker);
        }
        if (json.assistant != undefined) {
            this.assistant = new AssistantConfig(json.assistant);
        }
        if (json.task_tracker != undefined) {
            this.task_tracker = new TaskTrackerConfig(json.task_tracker);
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

        if (!this.users_fetcher) {
            return Expected.err("'users_fetcher' MUST be specified");
        }
        status = this.users_fetcher.verify();
        if (!status.ok) {
            return status.wrap_error("'users_fetcher' misconfiguration");
        }

        if (this.scores_fetcher) {
            status = this.scores_fetcher.verify();
            if (!status.ok) {
                return status.wrap_error("'scores_fetcher' misconfiguration");
            }
        }

        if (this.new_records_tracker) {
            status = this.new_records_tracker.verify();
            if (!status.ok) {
                return status.wrap_error("'new_records_tracker' misconfiguration");
            }
        }

        if (this.deposit_tracking) {
            status = this.deposit_tracking.verify();
            if (!status.ok) {
                return status;
            }
        } else {
            console.warn("'deposit_tracking' is not specifed, feature will be DISABLED");
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

        if (this.task_tracker) {
            status = this.task_tracker.verify();
            if (!status.ok) {
                return status.wrap_error("'task_tracker' misconfiguration");
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

        // TODO: delegate transaction_storage validation once the factory exposes verify().
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

    static HasDepoditTracker(): boolean {
        return this.current_config().deposit_tracking != undefined;
    }

    static HasOpenAI(): boolean {
        return this.data.openai_api_key_file != undefined;
    }

    static HasAssistant(): boolean {
        return this.current_config().assistant != undefined;
    }

    static HasScoresFetcher(): boolean {
        return this.current_config().scores_fetcher != undefined;
    }

    static HasNewRecordsTracker(): boolean {
        return this.current_config().new_records_tracker != undefined;
    }

    static HasTransactionStorage(): boolean {
        return this.data.transaction_storage != undefined;
    }

    static DepositTracker(): DepositTrackingConfig {
        const cfg = this.current_config().deposit_tracking;
        if (!cfg) {
            throw new Error("deposit_tracking is not specified!");
        }
        return cfg;
    }

    static TgAdapter(): TgAdapterConfig {
        const cfg = this.current_config().tg_adapter;
        if (!cfg) {
            throw new Error("tg_adapter is not specified!");
        }
        return cfg;
    }

    static UsersFetcher(): UsersFetcherConfig {
        const cfg = this.current_config().users_fetcher;
        if (!cfg) {
            throw new Error("users_fetcher is not specified!");
        }
        return cfg;
    }

    static ScoresFetcher(): ScoresFetcherConfig {
        const cfg = this.current_config().scores_fetcher;
        if (!cfg) {
            throw new Error("scores_fetcher is not specified!");
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