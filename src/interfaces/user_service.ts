import { UserData, UserId } from "@src/entities/user.js";
import { Expected } from "@src/utils/expected.js";


export interface IUserService {

    fetch_all(): Promise<UserData[]>;

    // Find a user by any subset of UserId fields (AND semantics on provided fields).
    resolve_user(user_id: Partial<UserId>): Promise<Expected<UserData | undefined>>;

}
