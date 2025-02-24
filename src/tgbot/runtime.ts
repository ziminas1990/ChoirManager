import { Database } from "./database.js";
import { UserLogic } from "./logic/user.js";

export class Runtime {
    private users: Map<number, UserLogic> = new Map();
    private guest: UserLogic | undefined;

    constructor(private database: Database) {}

    get_user(tg_id: string): UserLogic {
        const user = this.database.get_user_by_tg_id(tg_id);
        if (user) {
            let user_logic = this.users.get(user.id);
            if (!user_logic) {
                user_logic = new UserLogic(user);
                this.users.set(user.id, user_logic);
            }
            return user_logic;
        }
        return this.get_guest_user();
    }

    get_guest_user(): UserLogic {
        if (!this.guest) {
            this.guest = new UserLogic(this.database.get_guest_user());
        }
        return this.guest;
    }

    all_users(): IterableIterator<UserLogic> {
        return this.users.values();
    }
}