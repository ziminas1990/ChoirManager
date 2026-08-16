import { UserData, UserId } from "@src/entities/user.js";
import { Expected, Status } from "@src/utils/expected.js";


export type NewUserData = Omit<UserData, "id"> & {
    tg_username?: string;
};

export type UserPatch = Partial<Omit<UserData, "id">> & {
    tg_username?: string;
};

export interface IUserService {

    // Snapshot of all users
    fetch_all(): Promise<UserData[]>;

    // Find a user by system_id XOR tg_username.
    resolve_user(user_id: Partial<UserId>): Promise<Expected<UserData | undefined>>;

    // Return the user bound to tg_username or create a new one with no roles
    // (minimal permissions).
    resolve_or_create(tg_username: string): Promise<Expected<UserData>>;

    create(user: NewUserData): Promise<Expected<UserData>>;

    update(system_id: string, patch: UserPatch): Promise<Expected<UserData>>;

}

// Sync local-cache view for in-process callers (Runtime, etc.).
// Mental model: it should be implemented over IUserService and keep local copy of all
// users. Trade-off here is that local copy is not always up-to-date
export interface IUserServiceReplica {
    // Refresh the cache from the collection.
    sync(): Promise<Status>;

    fetch_all(): UserData[];

    resolve_user(user_id: Partial<UserId>): Expected<UserData | undefined>;
}
