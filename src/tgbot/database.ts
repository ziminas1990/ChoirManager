import { Status } from "../status.js";

export enum Role {
    Chorister = "chorister",
    Conductor = "conductor",
    Manager = "manager",
    Admin = "admin",
    Guest = "guest",
    Accountant = "accountant",
    ExChorister = "ex-chorister",
}

export enum Voice {
    Alto = "alto",
    Soprano = "soprano",
    Tenor = "tenor",
    Baritone = "baritone",
    Unknown = "unknown",
}

export enum Language {
    RU = "ru",
    EN = "en",
}

export class User {
    constructor(
        public tgid: string,
        public name: string,
        public surname: string,
        public lang: Language,
        public voice: Voice,
        public roles: Role[],
    ) {}

    public is(role: Role): boolean {
        return this.roles.includes(role);
    }

    // Returns diffs
    public update(user: User): string[] {
        if (this.tgid != user.tgid) {
            throw new Error("can't update user with different tgid");
        }

        const diffs: string[] = [];
        if (this.name != user.name) {
            diffs.push(`name: ${this.name} -> ${user.name}`);
            this.name = user.name;
        }
        if (this.surname != user.surname) {
            diffs.push(`surname: ${this.surname} -> ${user.surname}`);
            this.surname = user.surname;
        }
        if (this.lang != user.lang) {
            diffs.push(`lang: ${this.lang} -> ${user.lang}`);
            this.lang = user.lang;
        }
        if (this.voice != user.voice) {
            diffs.push(`voice: ${this.voice} -> ${user.voice}`);
            this.voice = user.voice;
        }

        for (const granted_role of user.roles) {
            if (!this.roles.includes(granted_role)) {
                diffs.push(`granted role: ${granted_role}`);
                this.roles.push(granted_role);
            }
        }

        for (const revoked_role of this.roles) {
            if (!user.roles.includes(revoked_role)) {
                diffs.push(`revoked role: ${revoked_role}`);
                this.roles = this.roles.filter(role => role != revoked_role);
            }
        }
        return diffs;
    }
}

export class Database {
    private users: Map<string, User> = new Map();

    public add_user(user: User): void {
        this.users.set(user.tgid, user);
    }

    public get_user(tg_id: string): User | undefined {
        return this.users.get(tg_id);
    }

    public all_users(): IterableIterator<User> {
        return this.users.values();
    }

    public verify(): Status {
        if (this.users.size == 0) {
            return Status.fail("no users found in database");
        }
        return Status.ok();
    }
}
