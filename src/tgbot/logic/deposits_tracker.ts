import { Journal } from "../journal.js";
import { Status, StatusWith } from "../../status.js";
import { Config } from "../config.js";
import { Deposit, DepositChange, DepositsFetcher } from "../fetchers/deposits_fetcher.js";
import { Logic } from "./abstracts.js";
import { seconds_since } from "../utils.js";

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
    private last_change_date: Date | undefined;
    private stashed_deposit: Deposit | undefined;
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

        if (events.length) {
            this.journal.log().info(`Produced ${events.length} events:`);
            for (const event of events) {
                this.journal.log().info({ event });
            }
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
        if (!changes) {
            // No changes since last fetch but probably we are waiting to send
            // notification about changes made during the last minute.
            return this.maybe_produce_change_event(now);
        }

        // Changes are detected but we shouldn't notify user immediatelly. We need to
        // wait at least 1 minute after the last change before notifying.
        // Will send notification once (now - last_change_date) > 1 minute
        this.last_change_date = now;
        // Save deposit before (there MAY be more changes during the next minute)
        this.stashed_deposit = this.last_deposit;
        this.last_deposit = deposit;
        return Status.ok().with([]);
    }

    private maybe_produce_change_event(now: Date): StatusWith<DepositsTrackerEvent[]> {
        if (!this.stashed_deposit || !this.last_change_date || !this.last_deposit) {
            return Status.ok().with([]);
        }

        const time_since_last_change = now.getTime() - this.last_change_date.getTime();
        if (time_since_last_change < this.collect_interval_ms) {
            return Status.ok().with([]);
        }

        const changes = Deposit.diff(this.stashed_deposit, this.last_deposit);
        if (!changes) {
            return Status.ok().with([]);
        }

        this.stashed_deposit = undefined;
        this.last_change_date = undefined;

        return Status.ok().with([{
            what: "update",
            deposit: this.last_deposit,
            changes
        }]);
    }

    private should_send_reminders(now: Date): boolean {
        const reminders_cfg = Config.DepositTracker().reminders;
        if (!reminders_cfg?.length) {
            return false;
        }

        // Find if there's a reminder configured for current day/hour
        const reminder = reminders_cfg.find(reminder =>
            reminder.day_of_month === now.getUTCDate() &&
            reminder.hour_utc === now.getUTCHours()
        );

        if (!reminder) {
            return false;
        }

        if (this.last_reminder_date && seconds_since(this.last_reminder_date) <= 3600) {
            return false;
        }

        this.last_reminder_date = now;
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

