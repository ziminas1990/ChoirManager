import { Status } from "../status.js";
import fs from "fs"

export class Config {

    public static data: {
        database_filename: string;
        runtime_cache_filename: string;
        google_cloud_key_file: string;
        tgbot_token_file: string;
        runtime_dump_interval_sec: number;
        deposit_tracking?: {
            google_sheet_id: string
            fetch_interval_sec: number,  // not less than 5 seconds
            collect_interval_sec: number  // not less than 5 seconds
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

    static DepositTracker() {
        if (!this.data.deposit_tracking) {
            throw new Error("deposit_tracking is not specified!")
        }
        return this.data.deposit_tracking!;
    }

    private static verify(): Status {

        const warnings: Status[] = []

        if (!this.data) {
            return Status.fail("configuration MUST be specified");
        }

        // Required files
        if (!this.data.database_filename) {
            return Status.fail("'database_filename' MUST be specified");
        }
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

        return Status.ok_and_warnings("verification", warnings);
    }
}