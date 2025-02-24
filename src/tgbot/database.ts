
export enum Role {
    Chorister = "chorister",
    Conductor = "conductor",
    Manager = "manager",
    Admin = "admin",
    Guest = "guest",
    ExChorister = "ex-chorister",
}

export type Language = "ru" | "en";

export class User {
    constructor(
        public id: number,
        public name: string,
        public surname: string,
        public roles: Role[],
        public tgig: string,
        public lang: Language
    ) {}

    public is(role: Role): boolean {
        return this.roles.includes(role);
    }

    static pack(user: User) {
        return [user.id, user.name, user.surname, user.roles, user.tgig, user.lang] as const;
    }

    static unpack(packed: ReturnType<typeof User.pack>): User {
        return new User(packed[0], packed[1], packed[2], packed[3], packed[4], packed[5]);
    }
}

export class Database {
    private users: Map<number, User> = new Map();
    private tg_users_index: Map<string, number> = new Map();

    constructor(users: User[]) {
        users.forEach(user => this.add_user(user));
    }

    public add_user(user: User): void {
        this.users.set(user.id, user);
        this.tg_users_index.set(user.tgig, user.id);
    }

    public get_user_by_tg_id(tg_id: string): User | undefined {
        const user_id = this.tg_users_index.get(tg_id);
        if (!user_id) {
            return undefined;
        }
        return this.users.get(user_id);
    }

    public get_guest_user(): User {
        let guest = this.users.get(0);
        if (!guest) {
            guest = new User(0, "Guest", "", [Role.Guest], "", "ru");
            this.users.set(0, guest);
        }
        return guest;
    }

    public all_users(): IterableIterator<User> {
        return this.users.values();
    }
}
