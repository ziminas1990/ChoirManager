import { Status, StatusWith } from "../../status.js";
import { apply_interval } from "../utils.js";

export abstract class Logic<Event> {

    private next_proceed: Date;

    constructor(private proceed_interval_ms: number)
    {
        this.next_proceed = new Date();
    }

    async proceed(now: Date): Promise<StatusWith<Event[]>> {
        if (this.next_proceed <= now) {
            apply_interval(this.next_proceed, { milliseconds: this.proceed_interval_ms });
            return this.proceed_impl(now);
        }
        return Status.ok().with<Event[]>([]);
    }

    protected abstract proceed_impl(now: Date): Promise<StatusWith<Event[]>>;
}
