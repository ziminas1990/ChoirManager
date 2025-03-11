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

function find<T>(array: Iterable<T>, what: Partial<T>): T | undefined {
    for (const item of array) {
        const keys = Object.keys(what) as (keyof T)[];
        if (keys.every(key => item[key] == what[key])) {
            return item;
        }
    }
    return undefined;
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

export class Scores {
    constructor(
        public name: string,
        public author: string,
        public hints: string,
        public duration: number,
        public file?: string,
    ) {}

    static csv_header(): string {
        return "name;author;hints;file";
    }

    public to_csv(separator: string = ";"): string {
        return [this.author, this.hints, this.duration, this.file]
            .map(s => `"${s}"`)
            .map(s => s.replace(separator, separator == ";" ? "," : ";"))
            .join(separator);
    }

    public get_key(): string {
        return `${this.author} by ${this.name}`;
    }

    public update(scores: Scores): string[] {
        if (this.author != scores.author) {
            return [`author: "${this.author}" -> "${scores.author}"`];
        }
        if (this.hints != scores.hints) {
            return [`hits: "${this.hints}" -> "${scores.hints}"`];
        }
        if (this.duration != scores.duration) {
            return [`duration: ${this.duration} -> ${scores.duration}`];
        }
        if (this.file != scores.file) {
            return [`file: "${this.file}" -> "${scores.file}"`];
        }
        return [];
    }
}

export class Database {
    private users: Map<string, User> = new Map();
    private scores: Map<string, Scores> = new Map();

    public add_user(user: User): void {
        this.users.set(user.tgid, user);
    }

    public add_scores(scores: Scores): void {
        this.scores.set(scores.get_key(), scores);
    }

    public get_user(tg_id: string): User | undefined {
        return this.users.get(tg_id);
    }

    public find_scores(what: Partial<Scores>): Scores | undefined {
        return find(this.scores.values(), what);
    }

    public all_users(): IterableIterator<User> {
        return this.users.values();
    }

    public all_scores(): IterableIterator<Scores> {
        return this.scores.values();
    }

    public verify(): Status {
        if (this.users.size == 0) {
            return Status.fail("no users found in database");
        }
        return Status.ok();
    }
}
