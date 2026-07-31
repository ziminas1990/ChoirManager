import { UserData, UserId } from "@src/entities/user.js";
import { Expected, Status } from "@src/utils/expected.js";


export interface IUserService {

    // Snapshot of registered (non-guest) users from the latest fetch.
    fetch_all(): Promise<UserData[]>;

    // Find a user by any subset of UserId fields (AND semantics on provided fields).
    resolve_user(user_id: Partial<UserId>): Promise<Expected<UserData | undefined>>;

    // Create or return an existing guest bound to telegram_id.
    create_guest(telegram_id: string): Promise<UserData>;

}

// Sync local-cache view for in-process callers (Runtime, etc.).
// Mental model: it should be implemented over IUserService and keep local copy of all
// users. Trade-off here is that local copy is not always up-to-date
export interface IUserServiceReplica {
    // Refresh the cache from storage.
    sync(): Promise<Status>;

    fetch_all(): UserData[];

    resolve_user(user_id: Partial<UserId>): Expected<UserData | undefined>;
}