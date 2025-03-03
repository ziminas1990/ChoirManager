import { Status, StatusWith } from "../../status.js";
import { Config } from "../config.js";
import { Deposit, DepositChange, DepositsFetcher } from "../fetchers/deposits_fetcher.js";
import { Logic } from "./abstracts.js";

export type DepositsTrackerEvent = {
    what: "deposit_change";
    deposit: Deposit;
    changes: DepositChange;
};


export class DepositsTracker extends Logic<DepositsTrackerEvent> {
    private last_deposit: Deposit | undefined;  // the most recent fetched deposit

    private last_change_date: Date | undefined;
    private stashed_deposit: Deposit | undefined;

    private collect_interval_ms = Config.DepositTracker().collect_interval_sec * 1000;

    constructor(
        private readonly tgid: string,
        private readonly deposit_fetcher: DepositsFetcher)
    {
        super(1000);
    }

    get_deposit(): Deposit | undefined {
        return this.last_deposit;
    }

    async proceed_impl(now: Date): Promise<StatusWith<DepositsTrackerEvent[]>> {
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
            what: "deposit_change",
            deposit: this.last_deposit, changes
        }]);
    }
}

