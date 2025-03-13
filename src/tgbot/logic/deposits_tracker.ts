import { Journal } from "../journal.js";
import { Status, StatusWith } from "../../status.js";
import { Config } from "../config.js";
import { Deposit, DepositChange, DepositsFetcher } from "../fetchers/deposits_fetcher.js";
import { Logic } from "./abstracts.js";
import { apply_interval } from "../utils.js";

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

    private collect_interval_ms = Config.DepositTracker().collect_interval_sec * 1000;

    private next_reminder_date?: Date;

    constructor(
        private readonly tgid: string,
        private readonly deposit_fetcher: DepositsFetcher,
        parent_journal: Journal)
    {
        super(1000);
        this.journal = parent_journal.child("deposit_tracker");

        // next reminder date should be at least 1 hour from now in order to avoid
        // reminder spamming if bot is restarting
        this.next_reminder_date = new Date(Date.now() + 1 * 60 * 60 * 1000);
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
            reminder.day_of_month === now.getDate() &&
            reminder.hour === now.getHours()
        );

        if (!reminder) {
            return false;
        }

        if (this.next_reminder_date && this.next_reminder_date > now) {
            return false;
        }

        const next_reminders = this.get_next_reminders(now);

        // find next reminder
        let next_reminder = next_reminders[0];
        if (!next_reminder) {
            // This should never happen, but just to be safe need to set next reminder
            // to the next month
            next_reminder = apply_interval(now, { months: 1 });
            this.journal.log().warn(`Can't get next reminder, setting to next month`);
        }
        this.journal.log().info(`Next reminder is ${next_reminder.toISOString()}`);
        this.next_reminder_date = next_reminder;
        return true;
    }

    private async check_reminders(now: Date): Promise<StatusWith<DepositsTrackerEvent[]>> {
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

    // Return reminders for current and next month sorted by date
    private get_next_reminders(now: Date): Date[] {
        const reminders_cfg = Config.DepositTracker().reminders;
        if (!reminders_cfg?.length) {
            return [];
        }

        const year = now.getFullYear();
        const month = now.getMonth();

        // build reminders for this and next month
        const planned_reminders: Date[] = [];
        reminders_cfg.forEach(reminder => {
            planned_reminders.push(
                new Date(year, month, reminder.day_of_month, reminder.hour),
                new Date(year, month + 1, reminder.day_of_month, reminder.hour)
            );
        });

        return planned_reminders
            .filter(reminder => reminder > now)
            .sort((a, b) => a.getTime() - b.getTime());
    }
}

