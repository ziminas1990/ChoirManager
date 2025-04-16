import fs from "fs"
import { Status } from "@src/status.js";
import { Formatting } from "@src/utils.js";
import { FeedbackStorageConfig, FeedbackStorageFactory } from "@src/adapters/feedback_storage/factory.js";
import { RehersalsStorageConfig, RehersalsStorageFactory } from "@src/adapters/rehersals_storage/factory.js";

export class Config {

    public static data: {
        runtime_cache_filename: string;
        google_cloud_key_file: string;
        runtime_dump_interval_sec: number;
        openai_api_key_file?: string;
        logs_file: string;
        tg_adapter: {
            token_file: string;
            formatting: Formatting;
        },
        users_fetcher: {
            google_sheet_id: string
            range: string,
            fetch_interval_sec: number,
        },
        scores_fetcher?: {
            google_sheet_id: string
            range: string,
            fetch_interval_sec: number,
        },
        deposit_tracking?: {
            google_sheet_id: string
            fetch_interval_sec: number,    // not less than 5 seconds
            collect_interval_sec: number,  // not less than 10 seconds
            membership_fee: number,        // in GEL
            reminders: Array<{
                day_of_month: number,      // 1-31
                hour_utc: number           // 0-23
            }>,
            reminder_cooldown_hours: number,
            startup_reminders_freeze_sec: number,
            accounts: Array<{
                title: string,
                account: string,
                receiver: string,
                comment: string
            }>
        },
        rehersals_tracker?: {
            fetch_interval_sec: number  // not less than 60 seconds
        },
        assistant?: {
            openai_api: "vanilla" | "assistant"
            model: "gpt-4o-mini" | "gpt-4o"
            fetch_interval_sec: number  // not less than 60 seconds
            faq_document_id: string
        },
        feedback_storage: FeedbackStorageConfig;
        rehersals_storage: RehersalsStorageConfig;
    }

    static Load(path: string): Status {
        try {
            const raw = fs.readFileSync(path, 'utf-8');
            Config.data = JSON.parse(raw);
            return Config.verify();
        } catch (error) {
            if (error instanceof Error) {
                return Status.fail(error.message);
            }
            return Status.fail(`${error}`);
        }
    }


    static HasTgAdapter(): boolean {
        return this.data.tg_adapter != undefined;
    }

    static HasDepoditTracker(): boolean {
        return this.data.deposit_tracking != undefined;
    }

    static HasOpenAI(): boolean {
        return this.data.openai_api_key_file != undefined;
    }

    static HasAssistant(): boolean {
        return this.data.assistant != undefined;
    }

    static HasScoresFetcher(): boolean {
        return this.data.scores_fetcher != undefined;
    }

    static DepositTracker() {
        if (!this.data.deposit_tracking) {
            throw new Error("deposit_tracking is not specified!")
        }
        return this.data.deposit_tracking!;
    }

    static TgAdapter() {
        if (!this.data.tg_adapter) {
            throw new Error("tg_adapter is not specified!")
        }
        return this.data.tg_adapter!;
    }

    static UsersFetcher() {
        if (!this.data.users_fetcher) {
            throw new Error("users_fetcher is not specified!")
        }
        return this.data.users_fetcher!;
    }

    static ScoresFetcher() {
        if (!this.data.scores_fetcher) {
            throw new Error("scores_fetcher is not specified!")
        }
        return this.data.scores_fetcher!;
    }

    static Assistant() {
        if (!this.data.assistant) {
            throw new Error("assistant is not specified!")
        }
        return this.data.assistant!;
    }

    private static verify(): Status {

        const warnings: Status[] = []

        if (!this.data) {
            return Status.fail("configuration MUST be specified");
        }

        // Required files
        if (!this.data.runtime_cache_filename) {
            return Status.fail("'runtime_cache_filename' MUST be specified");
        }
        if (!this.data.google_cloud_key_file) {
            return Status.fail("'google_cloud_key_file' MUST be specified");
        }
        if (!this.data.logs_file) {
            return Status.fail("'logs_file' MUST be specified");
        }

        if (!this.data.tg_adapter) {
            return Status.fail("'tg_adapter' MUST be specified");
        }
        if (!this.data.tg_adapter.token_file) {
            return Status.fail("'tg_adapter.token_file' MUST be specified");
        }
        if (!this.data.tg_adapter.formatting ||
            !["markdown", "html", "plain"].includes(this.data.tg_adapter.formatting)) {
            return Status.fail("'tg_adapter.formatting' MUST be specified (markdown, html, plain)");
        }

        // Runtime configuration
        if (!this.data.runtime_dump_interval_sec) {
            return Status.fail("'runtime_dump_interval_sec' MUST be specified");
        }
        if (this.data.runtime_dump_interval_sec < 0) {
            return Status.fail("'runtime_dump_interval_sec' MUST be positive");
        }

        // Users fetcher configuration
        if (this.data.users_fetcher == undefined) {
            return Status.fail("'users_fetcher' MUST be specified");
        }
        const cfg = this.data.users_fetcher;
        if (!cfg.google_sheet_id) {
            return Status.fail("'users_fetcher.google_sheet_id' MUST be specified");
        }
        if (!cfg.range) {
            return Status.fail("'users_fetcher.range' MUST be specified");
        }
        if (!cfg.fetch_interval_sec) {
            return Status.fail("'users_fetcher.fetch_interval_sec' MUST be specified");
        }
        if (cfg.fetch_interval_sec < 10) {
            return Status.fail("'users_fetcher.fetch_interval_sec' MUST be at least 10 seconds");
        }

        // Scores fetcher configuration
        if (this.data.scores_fetcher) {
            const cfg = this.data.scores_fetcher;
            if (!cfg.google_sheet_id) {
                return Status.fail("'scores_fetcher.google_sheet_id' MUST be specified");
            }
            if (!cfg.range) {
                return Status.fail("'scores_fetcher.range' MUST be specified");
            }
            if (!cfg.fetch_interval_sec) {
                return Status.fail("'scores_fetcher.fetch_interval_sec' MUST be specified");
            }
            if (cfg.fetch_interval_sec < 60) {
                return Status.fail("'scores_fetcher.fetch_interval_sec' MUST be at least 60 seconds");
            }
        }

        // Deposit tracking configuration
        if (this.data.deposit_tracking) {
            const fail_prefix = "deposit_tracking misconfiguration";
            const cfg = this.data.deposit_tracking;
            if (!cfg.google_sheet_id) {
                return Status.fail(`${fail_prefix}: 'google_sheet_id' MUST be specified`);
            }
            if (!cfg.fetch_interval_sec) {
                return Status.fail(`${fail_prefix}: 'fetch_interval_sec' MUST be specified`);
            }
            if (cfg.fetch_interval_sec < 5) {
                return Status.fail(`${fail_prefix}: 'fetch_interval_sec' MUST be at least 5 seconds`);
            }
            if (!cfg.collect_interval_sec) {
                return Status.fail(`${fail_prefix}: 'collect_interval_sec' MUST be specified`);
            }
            if (cfg.collect_interval_sec < 5) {
                return Status.fail(`${fail_prefix}: 'collect_interval_sec' MUST be at least 5 seconds`);
            }
            if (!cfg.membership_fee) {
                return Status.fail(`${fail_prefix}: 'membership_fee' MUST be specified`);
            }
            if (cfg.membership_fee <= 0) {
                return Status.fail(`${fail_prefix}: 'membership_fee' MUST be positive`);
            }
            if (cfg.fetch_interval_sec >= cfg.collect_interval_sec) {
                return Status.fail([
                    `${fail_prefix}:`,
                    `fetch_interval (${cfg.fetch_interval_sec})`,
                    `MUST be less than collect_interval_sec (${cfg.collect_interval_sec})`
                ].join(" "))
            }

            if (cfg.reminders && cfg.reminders.length > 0) {
                for (const reminder of cfg.reminders) {
                    if (!reminder.day_of_month) {
                        return Status.fail(`${fail_prefix}: 'day_of_month' MUST be specified`);
                    }
                    if (!reminder.hour_utc) {
                        return Status.fail(`${fail_prefix}: 'hour_utc' MUST be specified`);
                    }
                    if (reminder.day_of_month < 1 || reminder.day_of_month > 31) {
                        return Status.fail(`${fail_prefix}: 'day_of_month' MUST be between 1 and 31`);
                    }
                    if (reminder.hour_utc < 0 || reminder.hour_utc > 23) {
                        return Status.fail(`${fail_prefix}: 'hour_utc' MUST be between 0 and 23`);
                    }
                }
                if (cfg.reminder_cooldown_hours == undefined) {
                    return Status.fail(`${fail_prefix}: 'reminder_cooldown_hours' MUST be specified`);
                }
                if (cfg.startup_reminders_freeze_sec == undefined) {
                    return Status.fail(`${fail_prefix}: 'startup_reminders_freeze_sec' MUST be specified`);
                }
            }

            if (cfg.accounts && cfg.accounts.length > 0) {
                for (const account of cfg.accounts) {
                    if (!account.title) {
                        return Status.fail(`${fail_prefix}: account's 'title' MUST be specified`);
                    }
                    if (!account.account) {
                        return Status.fail(`${fail_prefix}: account's 'account' MUST be specified`);
                    }
                }
            }

        } else {
            warnings.push(Status.warning("'deposit_tracking' is not specifed, feature will be DISABLED"));
        }

        // Assistant configuration
        if (this.data.assistant) {
            const fail_prefix = "assistant misconfiguration";
            const cfg = this.data.assistant;
            if (!cfg.openai_api || !["vanilla", "assistant"].includes(cfg.openai_api)) {
                return Status.fail(`${fail_prefix}: 'openai_api' MUST be specified (vanilla or assistant)`);
            }
            if (!cfg.model || !["gpt-4o-mini", "gpt-4o"].includes(cfg.model)) {
                return Status.fail(`${fail_prefix}: 'model' MUST be specified (gpt-4o-mini or gpt-4o)`);
            }
            if (!cfg.faq_document_id) {
                return Status.fail(`${fail_prefix}: 'faq_document_id' MUST be specified`);
            }
            if (!cfg.fetch_interval_sec) {
                return Status.fail(`${fail_prefix}: 'fetch_interval_sec' MUST be specified`);
            }
            if (cfg.fetch_interval_sec < 60) {
                return Status.fail(`${fail_prefix}: 'fetch_interval_sec' MUST be at least 60 seconds`);
            }
        } else {
            warnings.push(Status.warning("'assistant' is not specifed, feature will be DISABLED"));
        }

        if (this.HasAssistant() && !this.HasOpenAI()) {
            warnings.push(Status.warning([
                "'assistant' is specifed, but 'openai_api_key_file' is not specifed,",
                " feature will be DISABLED",
            ].join()));
        }

        if (this.data.feedback_storage) {
            const status = FeedbackStorageFactory.verify(this.data.feedback_storage);
            if (!status.ok()) {
                return status.wrap("feedback_storage misconfiguration");
            }
        }

        if (this.data.rehersals_storage) {
            const status = RehersalsStorageFactory.verify(this.data.rehersals_storage);
            if (!status.ok()) {
                return status.wrap("rehersals_storage misconfiguration");
            }
        }

        if (this.data.rehersals_tracker) {
            if (!this.data.rehersals_storage) {
                return Status.fail("'rehersals_tracker' is specified, but 'rehersals_storage' is not specified");
            }
            const cfg = this.data.rehersals_tracker;
            if (!cfg.fetch_interval_sec) {
                return Status.fail("'rehersals_tracker.fetch_interval_sec' MUST be specified");
            }
            if (cfg.fetch_interval_sec < 10) {
                return Status.fail("'rehersals_tracker.fetch_interval_sec' MUST be at least 10 seconds");
            }
        }

        return Status.ok_and_warnings("verification", warnings);
    }
}