import { Status, StatusWith } from "@src/status.js";
import { apply_interval } from "@src/tgbot/utils.js";

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


export class Proceeder<Event> {
    private stop_request?: Promise<void>;
    private stop_resolve?: () => void;
    private running: boolean = false;

    constructor(private logic: Logic<Event>, private interval_ms: number = 50)
    {}

    async run(): Promise<Status> {
        if (this.running) {
            return Status.fail("already running");
        }
        this.running = true;

        while(!this.stop_request) {
            const status = await this.logic.proceed(new Date());
            if (!status.done()) {
                this.running = false;
                return status.wrap("proceeding problem")
            }
            await new Promise(resolve => setTimeout(resolve, this.interval_ms));
        }

        this.running = false;
        this.stop_resolve?.();
        this.stop_request = undefined;
        this.stop_resolve = undefined;
        return Status.ok();
    }

    async stop(): Promise<void> {
        if (!this.running) {
            return;
        }

        if (!this.stop_request) {
            this.stop_request = new Promise((resolve) => {
                this.stop_resolve = resolve;
            });
        }
        await this.stop_request;
    }
}