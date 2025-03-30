import { Journal } from "@src/tgbot/journal.js";
import { Status, StatusWith } from "@src/status.js";
import { Config } from "@src/tgbot/config.js";
import { Deposit, DepositChange, DepositsFetcher } from "@src/tgbot/fetchers/deposits_fetcher.js";
import { Logic } from "./abstracts.js";
import { seconds_since } from "@src/tgbot/utils.js";
import { Runtime } from "../runtime.js";

export type DepositsTrackerEvent = {
    what: "update",
    deposit: Deposit,
    changes: DepositChange
} | {
    what: "reminder",
    tgid: string,
    chorister: string,
    amount: number
}

export class DepositsTracker extends Logic<DepositsTrackerEvent> {
    private last_deposit: Deposit | undefined;  // the most recent fetched deposit
    private journal: Journal;
    private pending_change?: {
        before: Deposit,
        last_update: Date,
    }

    private deposit_fetcher?: DepositsFetcher;

    private collect_interval_ms = Config.DepositTracker().collect_interval_sec * 1000;

    private last_reminder_date?: Date;

    constructor(
        private readonly tgid: string,
        parent_journal: Journal)
    {
        super(1000);
        this.journal = parent_journal.child("deposit_tracker");
    }

    attach_deposit_fetcher(deposit_fetcher: DepositsFetcher): void {
        this.deposit_fetcher = deposit_fetcher;
    }

    get_deposit(): Deposit | undefined {
        return this.last_deposit;
    }

    protected async proceed_impl(now: Date): Promise<StatusWith<DepositsTrackerEvent[]>> {
        const events: DepositsTrackerEvent[] = [];

        // Check for updates
        const update_status = await this.check_updates(now);
        if (!update_status.ok()) {
            return update_status.wrap("failed to check updates");
        }
        events.push(...update_status.value!);

        // Check for reminders
        const reminder_status = await this.check_reminders(now);
        if (!reminder_status.ok()) {
            return reminder_status.wrap("failed to check reminders");
        }
        events.push(...reminder_status.value!);

        for (const event of events) {
            this.journal.log().info({ event });
        }

        return StatusWith.ok().with(events);
    }

    private async check_updates(now: Date): Promise<StatusWith<DepositsTrackerEvent[]>> {
        if (!this.deposit_fetcher) {
            return Status.ok().with([]);
        }

        const deposit = this.deposit_fetcher.get_user_deposit(this.tgid);
        if (!deposit) {
            return Status.ok().with([]);
        }
        if (!this.last_deposit) {
            this.last_deposit = deposit;
            return Status.ok().with([]);
        }

        const changes = Deposit.diff(this.last_deposit, deposit);
        if (changes) {
            if (this.pending_change == undefined) {
                this.pending_change = {
                    before: this.last_deposit,
                    last_update: now,
                };
            }
            this.pending_change.last_update = now;
        }

        this.last_deposit = deposit;
        return this.maybe_produce_change_event(now);
    }

    private maybe_produce_change_event(now: Date): StatusWith<DepositsTrackerEvent[]> {
        if (!this.pending_change || !this.last_deposit) {
            return Status.ok().with([]);
        }

        const time_since_last_change = now.getTime() - this.pending_change.last_update.getTime();
        if (time_since_last_change < this.collect_interval_ms) {
            return Status.ok().with([]);
        }

        const changes = Deposit.diff(this.pending_change.before, this.last_deposit);
        if (!changes) {
            return Status.ok().with([]);
        }
        this.pending_change = undefined;

        return Status.ok().with([{
            what: "update",
            deposit: this.last_deposit,
            changes
        }]);
    }

    private should_send_reminders(now: Date): boolean {
        const cfg = Config.DepositTracker();
        if (!cfg.reminders?.length) {
            return false;
        }

        // TODO: replace with configurable value
        if (Runtime.get_instance().running_time_sec() < 3600) {
            // Do not produce any reminders during the hour after restart
            return false;
        }

        // Find if there's a reminder configured for current day/hour
        const reminder = cfg.reminders.find(reminder =>
            reminder.day_of_month === now.getUTCDate() &&
            reminder.hour_utc === now.getUTCHours()
        );

        if (!reminder) {
            return false;
        }

        if (this.last_reminder_date) {
            const seconds_since_last_reminder = seconds_since(this.last_reminder_date);
            const reminder_cooldown_sec = 3600 * cfg.reminder_cooldown_hours;
            return seconds_since_last_reminder > reminder_cooldown_sec;
        }
        return true;
    }

    private async check_reminders(now: Date): Promise<StatusWith<DepositsTrackerEvent[]>> {
        if (!this.deposit_fetcher) {
            return StatusWith.ok().with([]);
        }

        if (!this.should_send_reminders(now)) {
            return StatusWith.ok().with([]);
        }

        const events: DepositsTrackerEvent[] = [];

        // Check chorister's payment for current month
        const deposit = this.deposit_fetcher.get_user_deposit(this.tgid);
        if (!deposit) {
            return StatusWith.ok().with([]);
        }

        const diff = Config.DepositTracker().membership_fee - deposit.current_month_balance();
        if (diff > 0) {
            this.last_reminder_date = now;
            events.push({
                what: "reminder",
                tgid: this.tgid,
                chorister: deposit.chorister,
                amount: diff
            });
        }

        return StatusWith.ok().with(events);
    }

    static pack(user: DepositsTracker) {
        return {
            "last_reminder": user.last_reminder_date?.getTime(),
        } as const;
    }

    static unpack(
        tgid: string,
        packed: ReturnType<typeof DepositsTracker.pack>,
        parent_journal: Journal
    ): DepositsTracker {
        const [last_reminder] = [packed.last_reminder];
        const logic = new DepositsTracker(tgid, parent_journal);
        logic.last_reminder_date = last_reminder ? new Date(last_reminder) : undefined;
        return logic;
    }
}

