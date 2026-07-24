import { UserData } from "@src/entities/user.js";


export interface IUsersStorage {

    fetch_all(): Promise<UserData[]>;

}