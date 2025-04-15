import { Status } from "@src/status.js";

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

export function voice_from_string(voice: string | undefined): Voice {
    if (!voice) {
        return Voice.Unknown;
    }
    return Voice[voice as keyof typeof Voice] || Voice.Unknown;
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

export class Song {
    constructor(public id: number, public name: string) {}
}

export type RehersalData = {
    rehersal_id: number;
    date: Date;
    duration_minutes: Map<Voice, number>;
};

export class Rehersal {
    constructor(private data: RehersalData) {}

    public id(): number {
        return this.data.rehersal_id;
    }

    public duration(voice: Voice): number {
        return this.data.duration_minutes.get(voice) || 0;
    }

    public when(): Date {
        return new Date(this.data.date);
    }
}

export class Database {
    // tg_id -> user
    private users: Map<string, User> = new Map();
    private scores: Map<string, Scores> = new Map();
    private songs: Map<number, Song> = new Map();
    private rehersals: Map<number, RehersalData> = new Map();

    // rehersal_id -> song_id -> minutes
    private rehersal_songs: Map<number, Map<number, number>> = new Map();
    // rehersal_id -> tgid -> minutes
    private rehersal_participants: Map<number, Map<string, number>> = new Map();

    // rehersal date (timestamp) -> rehersal_id
    private rehersals_index: Map<number, number> = new Map();
    // song_name -> song_id
    private songs_index: Map<string, number> = new Map();

    public add_user(user: User): void {
        this.users.set(user.tgid, user);
    }

    public add_scores(scores: Scores): void {
        this.scores.set(scores.get_key(), scores);
    }

    public add_song(name: string): Song {
        {
            // Check if already exists (not a problem)
            const song_id = this.songs_index.get(name);
            if (song_id) {
                return this.songs.get(song_id)!;
            }
        }

        const song = new Song(this.songs.size + 1, name);
        this.songs.set(song.id, song);
        this.songs_index.set(name, song.id);
        return song;
    }

    public add_rehersal(date: Date): Rehersal {
        {
            // Check if already exists (not a problem)
            const rehersal_id = this.rehersals_index.get(date.getTime());
            if (rehersal_id) {
                return new Rehersal(this.rehersals.get(rehersal_id)!);
            }
        }

        const rehersal = {
            rehersal_id: this.rehersals.size + 1,
            date,
            duration_minutes: new Map(),
        };
        this.rehersals.set(rehersal.rehersal_id, rehersal);
        this.rehersals_index.set(date.getTime(), rehersal.rehersal_id);
        return new Rehersal(rehersal);
    }

    public add_song_to_rehersal(rehersal: Rehersal, song_id: number, minutes: number): Status {
        if (!this.rehersals.has(rehersal.id())) {
            return Status.fail(`rehersal ${rehersal.id()} not found`);
        }
        if (!this.songs.has(song_id)) {
            return Status.fail(`song ${song_id} not found`);
        }
        let rehersal_songs = this.rehersal_songs.get(rehersal.id());
        if (!rehersal_songs) {
            rehersal_songs = new Map();
            this.rehersal_songs.set(rehersal.id(), rehersal_songs);
        }
        rehersal_songs.set(song_id, minutes);
        return Status.ok();
    }

    public add_participant_to_rehersal(rehersal: Rehersal, tgid: string, minutes: number): Status {
        if (!this.rehersals.has(rehersal.id())) {
            return Status.fail(`rehersal ${rehersal.id()} not found`);
        }
        if (!this.users.has(tgid)) {
            return Status.fail(`user ${tgid} not found`);
        }
        let rehersal_participants = this.rehersal_participants.get(rehersal.id());
        if (!rehersal_participants) {
            rehersal_participants = new Map();
            this.rehersal_participants.set(rehersal.id(), rehersal_participants);
        }
        rehersal_participants.set(tgid, minutes);

        const chorister = this.users.get(tgid);
        const rehersal_data = this.rehersals.get(rehersal.id());
        if (chorister && rehersal_data) {
            const voice = chorister.voice;
            const duration_minutes = rehersal_data.duration_minutes.get(voice);
            if (duration_minutes == undefined || duration_minutes < minutes) {
                rehersal_data.duration_minutes.set(voice, minutes);
            }
        }
        return Status.ok();
    }

    public get_visited_rehersals(tg_id: string): Rehersal[] {
        const rehersals: Rehersal[] = [];
        for (const [rehersal_id, visitors] of this.rehersal_participants) {
            if (visitors.has(tg_id)) {
                rehersals.push(new Rehersal(this.rehersals.get(rehersal_id)!));
            }
        }
        return rehersals;
    }

    // How much time a user with the specified 'tg_id' spent on the rehersal with the
    // specified 'rehersal_id' (in minutes)
    public time_on_rehersal(tg_id: string, rehersal_id: number): number {
        const rehersal = this.rehersals.get(rehersal_id);
        if (!rehersal) {
            return 0;
        }
        return this.rehersal_participants.get(rehersal_id)?.get(tg_id) || 0;
    }

    public get_user(tg_id: string): User | undefined {
        return this.users.get(tg_id);
    }

    public create_guest_user(tg_id: string): User {
        const guest = new User(tg_id, "", "", Language.EN, Voice.Unknown, [Role.Guest]);
        this.users.set(tg_id, guest);
        return guest;
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
