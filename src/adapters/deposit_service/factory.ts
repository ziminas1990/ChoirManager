import {
    DepositStorageConfig,
    DepositStorageFactory,
} from "@src/adapters/deposit_storage/factory.js";
import {
    TransactionStorageConfig,
    TransactionStorageFactory,
} from "@src/adapters/transactions_storage/factory.js";
import { DepositService } from "@src/components/deposit_service.js";
import { DepositEvent } from "@src/interfaces/deposit_service.js";
import { IBroadcaster } from "@src/interfaces/message_queue.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";

export type DepositReminderConfigJson = {
    day_of_month: number;
    hour_utc: number;
}

export type DepositAccountConfigJson = {
    title: string;
    account: string;
    receiver?: string;
    comment?: string;
}

// Slim UI-facing slice of DepositServiceConfig (fee + payment accounts).
// Kept off IDepositService so the service stays remoting-ready.
export type DepositPresentationConfig = {
    membership_fee: number;
    accounts: DepositAccountConfigJson[];
}

// "local" — DepositService is instantiated in-process on top of IDepositStorage + ITransactionsStorage.
export type DepositServiceConfigJson = {
    type: "local";
    deposits: DepositStorageConfig;
    transactions: TransactionStorageConfig;
    fetch_interval_sec: number;
    collect_interval_sec: number;
    membership_fee: number;
    reminders?: DepositReminderConfigJson[];
    reminder_cooldown_hours?: number;
    startup_reminders_freeze_sec?: number;
    accounts?: DepositAccountConfigJson[];
}

export class DepositServiceConfig {
    constructor(private readonly json: DepositServiceConfigJson) {}

    get type(): "local" {
        return this.json.type;
    }

    get deposits(): DepositStorageConfig {
        return this.json.deposits;
    }

    get transactions(): TransactionStorageConfig {
        return this.json.transactions;
    }

    get fetch_interval_sec(): number {
        return this.json.fetch_interval_sec;
    }

    get collect_interval_sec(): number {
        return this.json.collect_interval_sec;
    }

    get membership_fee(): number {
        return this.json.membership_fee;
    }

    get reminders(): DepositReminderConfigJson[] {
        return this.json.reminders ?? [];
    }

    get reminder_cooldown_hours(): number {
        return this.json.reminder_cooldown_hours ?? 0;
    }

    get startup_reminders_freeze_sec(): number {
        return this.json.startup_reminders_freeze_sec ?? 0;
    }

    get accounts(): DepositAccountConfigJson[] {
        return this.json.accounts ?? [];
    }

    verify(): Status {
        if (!this.json.type) {
            return Expected.err("'type' MUST be specified");
        }
        if (this.json.type !== "local") {
            return Expected.err("'type' MUST be: local");
        }

        if (!this.json.deposits) {
            return Expected.err("'deposits' MUST be specified");
        }
        const deposits_status = DepositStorageFactory.verify(this.json.deposits);
        if (!deposits_status.ok) {
            return deposits_status.wrap_error("'deposits' misconfiguration");
        }

        if (!this.json.transactions) {
            return Expected.err("'transactions' MUST be specified");
        }
        const transactions_status = TransactionStorageFactory.verify(this.json.transactions);
        if (!transactions_status.ok) {
            return transactions_status.wrap_error("'transactions' misconfiguration");
        }

        if (!this.json.fetch_interval_sec) {
            return Expected.err("'fetch_interval_sec' MUST be specified");
        }
        if (this.json.fetch_interval_sec < 5) {
            return Expected.err("'fetch_interval_sec' MUST be at least 5 seconds");
        }
        if (!this.json.collect_interval_sec) {
            return Expected.err("'collect_interval_sec' MUST be specified");
        }
        if (this.json.collect_interval_sec < 5) {
            return Expected.err("'collect_interval_sec' MUST be at least 5 seconds");
        }
        if (this.json.fetch_interval_sec >= this.json.collect_interval_sec) {
            return Expected.err([
                `fetch_interval (${this.json.fetch_interval_sec})`,
                `MUST be less than collect_interval_sec (${this.json.collect_interval_sec})`,
            ].join(" "));
        }

        if (this.json.membership_fee == undefined) {
            return Expected.err("'membership_fee' MUST be specified");
        }
        if (this.json.membership_fee <= 0) {
            return Expected.err("'membership_fee' MUST be positive");
        }

        if (this.reminders.length > 0) {
            for (const reminder of this.reminders) {
                if (reminder.day_of_month == undefined) {
                    return Expected.err("'day_of_month' MUST be specified");
                }
                if (reminder.hour_utc == undefined) {
                    return Expected.err("'hour_utc' MUST be specified");
                }
                if (reminder.day_of_month < 1 || reminder.day_of_month > 31) {
                    return Expected.err("'day_of_month' MUST be between 1 and 31");
                }
                if (reminder.hour_utc < 0 || reminder.hour_utc > 23) {
                    return Expected.err("'hour_utc' MUST be between 0 and 23");
                }
            }
            if (this.json.reminder_cooldown_hours == undefined) {
                return Expected.err("'reminder_cooldown_hours' MUST be specified");
            }
            if (this.json.startup_reminders_freeze_sec == undefined) {
                return Expected.err("'startup_reminders_freeze_sec' MUST be specified");
            }
        }

        if (this.accounts.length > 0) {
            for (const account of this.accounts) {
                if (!account.title) {
                    return Expected.err("account's 'title' MUST be specified");
                }
                if (!account.account) {
                    return Expected.err("account's 'account' MUST be specified");
                }
            }
        }

        return Expected.ok(undefined);
    }
}

export class DepositServiceFactory {
    static create(
        config: DepositServiceConfig,
        broadcaster: IBroadcaster<DepositEvent>,
        parent_journal: Journal,
    ): Expected<DepositService> {
        switch (config.type) {
            case "local": {
                const deposits_status = DepositStorageFactory.create(
                    config.deposits,
                    parent_journal,
                );
                if (!deposits_status.ok) {
                    return deposits_status.wrap_error("can't create deposits storage");
                }

                const transactions_status = TransactionStorageFactory.create(config.transactions);
                if (!transactions_status.ok) {
                    return transactions_status.wrap_error("can't create transactions storage");
                }

                return Expected.ok(new DepositService(
                    config.fetch_interval_sec,
                    config.collect_interval_sec,
                    config.membership_fee,
                    config.reminders,
                    config.reminder_cooldown_hours,
                    config.startup_reminders_freeze_sec,
                    deposits_status.value,
                    transactions_status.value,
                    broadcaster,
                    parent_journal,
                ));
            }
        }
    }
}
