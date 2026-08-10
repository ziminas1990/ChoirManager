import { Deposit, DepositChange } from "@src/entities/deposit.js";
import { IBroadcaster } from "@src/interfaces/message_queue.js";
import { DepositEvent, IDepositService } from "@src/interfaces/deposit_service.js";
import { IDepositStorage } from "@src/interfaces/storage/deposit_storage.js";
import { ITransactionsStorage, Transaction } from "@src/interfaces/transactions_storage.js";
import { Journal } from "@src/journal.js";
import { Logic } from "@src/logic/abstracts.js";
import { Expected, Status } from "@src/utils/expected.js";

export type DepositReminderSchedule = {
    day_of_month: number;
    hour_utc: number;
}

type PendingChange = {
    before: Deposit;
    last_update: Date;
}

export class DepositService extends Logic<void> implements IDepositService {
    private readonly journal: Journal;

    // Latest fetched deposits by tgid.
    private deposits = new Map<string, Deposit>();
    // Debounced changes awaiting collect_interval_sec of stability.
    private pending = new Map<string, PendingChange>();

    private last_fetch_date?: Date;
    private last_reminder_date?: Date;
    private started_at?: Date;

    constructor(
        private readonly fetch_interval_sec: number,
        private readonly collect_interval_sec: number,
        private readonly membership_fee: number,
        private readonly reminders: readonly DepositReminderSchedule[],
        private readonly reminder_cooldown_hours: number,
        private readonly startup_reminders_freeze_sec: number,
        private readonly deposits_storage: IDepositStorage,
        private readonly transactions_storage: ITransactionsStorage,
        private readonly broadcaster: IBroadcaster<DepositEvent>,
        parent_journal: Journal,
    ) {
        // Short tick so debounce and reminder windows are checked promptly;
        // sheet refetch is throttled separately via fetch_interval_sec.
        super(1000);
        this.journal = parent_journal.child("deposit_svc");
    }

    async init(now: Date = new Date()): Promise<Status> {
        this.started_at = now;
        return await this.refetch(now, /*emit_changes=*/ false);
    }

    async get_deposit(tgid: string): Promise<Expected<Deposit | undefined>> {
        return Expected.ok(this.deposits.get(tgid));
    }

    async fetch_transactions(
        tgid: string,
        opts: { limit?: number; order?: "asc" | "desc" },
    ): Promise<Transaction[]> {
        return await this.transactions_storage.fetch_transactions(tgid, opts);
    }

    protected async proceed_impl(now: Date, _interval_ms: number): Promise<Expected<void[]>> {
        if (this.time_to_fetch(now)) {
            const refetch_status = await this.refetch(now, /*emit_changes=*/ true);
            if (!refetch_status.ok) {
                this.journal.log().warn(`Failed to refetch deposits: ${refetch_status.error}`);
            }
        }

        const flush_status = await this.flush_stable_changes(now);
        if (!flush_status.ok) {
            this.journal.log().warn(`Failed to flush deposit changes: ${flush_status.error}`);
        }

        const reminder_status = await this.maybe_send_reminders(now);
        if (!reminder_status.ok) {
            this.journal.log().warn(`Failed to send deposit reminders: ${reminder_status.error}`);
        }

        return Expected.ok([]);
    }

    private time_to_fetch(now: Date): boolean {
        if (!this.last_fetch_date) {
            return true;
        }
        const fetch_interval_ms = this.fetch_interval_sec * 1000;
        return now.getTime() - this.last_fetch_date.getTime() >= fetch_interval_ms;
    }

    private async refetch(now: Date, emit_changes: boolean): Promise<Status> {
        let fetched: Deposit[];
        try {
            fetched = await this.deposits_storage.fetch_all();
        } catch (e) {
            return Expected.exception("can't fetch deposits", e);
        }

        this.last_fetch_date = now;

        for (const deposit of fetched) {
            if (!deposit.tgid) {
                continue;
            }

            const prev = this.deposits.get(deposit.tgid);
            if (prev && emit_changes) {
                const changes = Deposit.diff(prev, deposit);
                if (changes) {
                    const pending = this.pending.get(deposit.tgid);
                    if (!pending) {
                        this.pending.set(deposit.tgid, {
                            before: prev,
                            last_update: now,
                        });
                    } else {
                        pending.last_update = now;
                    }
                }
            }

            this.deposits.set(deposit.tgid, deposit);
        }

        this.journal.log().info({ deposits_count: this.deposits.size }, "Deposits cache refreshed");
        return Expected.ok(undefined);
    }

    private async flush_stable_changes(now: Date): Promise<Status> {
        const collect_interval_ms = this.collect_interval_sec * 1000;
        const confirmed: { tgid: string; deposit: Deposit; changes: DepositChange }[] = [];

        for (const [tgid, pending] of this.pending) {
            const time_since_last_change = now.getTime() - pending.last_update.getTime();
            if (time_since_last_change < collect_interval_ms) {
                continue;
            }

            const current = this.deposits.get(tgid);
            if (!current) {
                this.pending.delete(tgid);
                continue;
            }

            const changes = Deposit.diff(pending.before, current);
            this.pending.delete(tgid);
            if (!changes) {
                continue;
            }

            confirmed.push({ tgid, deposit: current, changes });
        }

        for (const { tgid, deposit, changes } of confirmed) {
            const tx_status = await this.write_transactions(tgid, changes);
            if (!tx_status.ok) {
                this.journal.log().warn(
                    `Failed to write transactions for ${tgid}: ${tx_status.error}`,
                );
            }

            const event: DepositEvent = {
                what: "update",
                tgid,
                deposit,
                changes,
            };
            this.journal.log().info({ event }, "deposit update");
            const broadcast_status = await this.broadcaster.broadcast(event);
            if (!broadcast_status.ok) {
                this.journal.log().warn(
                    `Failed to broadcast update for ${tgid}: ${broadcast_status.error}`,
                );
            }
        }

        return Expected.ok(undefined);
    }

    private async write_transactions(tgid: string, changes: DepositChange): Promise<Status> {
        const date = new Date();
        try {
            if (changes.balance) {
                await this.transactions_storage.add_transaction({
                    date,
                    tgid,
                    type: "balance",
                    before: changes.balance[0],
                    after: changes.balance[1],
                });
            }

            if (changes.membership) {
                for (const [month, before, after] of changes.membership) {
                    await this.transactions_storage.add_transaction({
                        date,
                        tgid,
                        type: "membership",
                        membership_month: month,
                        before,
                        after,
                    });
                }
            }
        } catch (e) {
            return Expected.exception("can't write deposit transactions", e);
        }
        return Expected.ok(undefined);
    }

    private should_send_reminders(now: Date): boolean {
        if (this.reminders.length === 0) {
            return false;
        }

        if (this.started_at) {
            const running_time_sec = (now.getTime() - this.started_at.getTime()) / 1000;
            if (running_time_sec < this.startup_reminders_freeze_sec) {
                return false;
            }
        }

        const reminder = this.reminders.find(r =>
            r.day_of_month === now.getUTCDate() &&
            r.hour_utc === now.getUTCHours()
        );
        if (!reminder) {
            return false;
        }

        if (this.last_reminder_date) {
            const seconds_since_last =
                (now.getTime() - this.last_reminder_date.getTime()) / 1000;
            const cooldown_sec = 3600 * this.reminder_cooldown_hours;
            return seconds_since_last > cooldown_sec;
        }
        return true;
    }

    private async maybe_send_reminders(now: Date): Promise<Status> {
        if (!this.should_send_reminders(now)) {
            return Expected.ok(undefined);
        }

        const events: DepositEvent[] = [];
        for (const deposit of this.deposits.values()) {
            const amount = this.membership_fee - deposit.current_month_balance();
            if (amount <= 0) {
                continue;
            }
            events.push({
                what: "reminder",
                tgid: deposit.tgid,
                chorister: deposit.chorister,
                amount,
            });
        }

        if (events.length === 0) {
            return Expected.ok(undefined);
        }

        // One reminder wave per cooldown window, even if some broadcasts fail.
        this.last_reminder_date = now;

        for (const event of events) {
            this.journal.log().info({ event }, "deposit reminder");
            const status = await this.broadcaster.broadcast(event);
            if (!status.ok) {
                this.journal.log().warn(
                    `Failed to broadcast reminder for ${event.tgid}: ${status.error}`,
                );
            }
        }

        return Expected.ok(undefined);
    }
}
