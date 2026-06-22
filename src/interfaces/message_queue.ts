import { Expected, Status } from "@src/utils/expected";

export interface ISubscription<T> {
    unsubscribe(): Promise<Status>;

    poll(): Promise<Expected<T | undefined>>;
}

export interface IBroadcaster<T> {

    broadcast(message: T): Promise<Status>;

    subscribe(): ISubscription<T>;

}