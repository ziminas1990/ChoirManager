import { Status } from "../status.js";
import fs from "fs"

export class Config {

    public static data: {
        runtime_cache_filename: string;
        google_cloud_key_file: string;
        tgbot_token_file: string;
        runtime_dump_interval_sec: number;
        openai_api_key_file?: string;
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
            fetch_interval_sec: number,  // not less than 5 seconds
            collect_interval_sec: number  // not less than 10 seconds
        },
        assistant?: {
            openai_api: "vanilla" | "assistant"
            model: "gpt-4o-mini" | "gpt-4o"
            fetch_interval_sec: number  // not less than 60 seconds
            faq_document_id: string
        }
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
        if (!this.data.tgbot_token_file) {
            return Status.fail("'tgbot_token_file' MUST be specified");
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
            if (cfg.fetch_interval_sec >= cfg.collect_interval_sec) {
                return Status.fail([
                    `${fail_prefix}:`,
                    `fetch_interval (${cfg.fetch_interval_sec})`,
                    `MUST be less than collect_interval_sec (${cfg.collect_interval_sec})`
                ].join(" "))
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

        return Status.ok_and_warnings("verification", warnings);
    }
}