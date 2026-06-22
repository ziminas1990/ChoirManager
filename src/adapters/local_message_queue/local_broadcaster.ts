import { IBroadcaster, ISubscription } from "@src/interfaces/message_queue.js";
import { Expected, Status } from "@src/utils/expected.js";


export class LocalBroadcaster<T> implements IBroadcaster<T> {

    private subscriptions: LocalSubscription<T>[] = [];

    async broadcast(message: T): Promise<Status> {
        this.subscriptions.forEach(subscription => subscription.put(message));
        return Expected.ok(undefined);
    }

    subscribe(): ISubscription<T> {
        const subscription = new LocalSubscription<T>(this);
        this.subscriptions.push(subscription);
        return subscription;
    }

    unsubscribe(subscription: ISubscription<T>): Status {
        if (!(subscription instanceof LocalSubscription)) {
            return Expected.err("Invalid subscription object, must be a LocalSubscription");
        }

        const index = this.subscriptions.indexOf(subscription);
        if (index === -1) {
            return Expected.err("Subscription not found in the broadcaster");
        }
        this.subscriptions.splice(index, 1);
        return Expected.ok(undefined);
    }
}

export class LocalSubscription<T> implements ISubscription<T> {

    private message_queue: T[] = [];

    constructor(private broadcaster: LocalBroadcaster<T>) {}

    async poll(): Promise<Expected<T | undefined>> {
        if (this.message_queue.length === 0) {
            return Expected.ok(undefined);
        }
        return Expected.ok(this.message_queue.shift());
    }

    put(message: T): void {
        this.message_queue.push(message);
    }

    async unsubscribe(): Promise<Status> {
        return this.broadcaster.unsubscribe(this);
    }
}