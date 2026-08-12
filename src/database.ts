import { Voice } from "@src/entities/user.js";
import { Expected, Status } from "@src/utils/expected.js";

export class Song {
    constructor(public id: number, public name: string) {}
}

export type RehersalData = {
    rehersal_id: number;
    date: Date;
    duration_minutes: Map<Voice, number>;
};

export class Rehersal {
    constructor(
        private database: Database,
        private readonly data: RehersalData,
    ) {}

    public id(): number {
        return this.data.rehersal_id;
    }

    public duration(voice: Voice): number {
        return this.data.duration_minutes.get(voice) || 0;
    }

    public minutes_of_presence(tgid: string): number {
        return this.database.lowlevel().rehersal_participants.get(this.id())?.get(tgid) || 0;
    }

    // Returns tgids of choristers with positive presence minutes.
    public present_participants(): string[] {
        const participants = this.database.lowlevel().rehersal_participants.get(this.id());
        if (!participants) {
            return [];
        }
        const result: string[] = [];
        for (const [tgid, minutes] of participants) {
            if (minutes > 0) {
                result.push(tgid);
            }
        }
        return result;
    }

    public songs(): { name: string, minutes: number }[] {
        const rehersal_songs = this.database.lowlevel().rehersal_songs.get(this.id());
        if (!rehersal_songs) {
            return [];
        }
        const songs: { name: string, minutes: number }[] = [];
        for (const [song_id, minutes] of rehersal_songs) {
            const song = this.database.lowlevel().songs.get(song_id);
            if (song) {
                songs.push({ name: song.name, minutes });
            }
        }
        return songs;
    }

    public when(): Date {
        return new Date(this.data.date);
    }
}

export type Data = {
    songs: Map<number, Song>;
    rehersals: Map<number, RehersalData>;
    // rehersal_id -> song_id -> minutes
    rehersal_songs: Map<number, Map<number, number>>;
    // rehersal_id -> tgid -> minutes
    rehersal_participants: Map<number, Map<string, number>>;
    rehersals_index: Map<number, number>;
    songs_index: Map<string, number>;
};

export class Database {
    private data: Data = {
        songs: new Map(),
        rehersals: new Map(),
        rehersal_songs: new Map(),
        rehersal_participants: new Map(),
        rehersals_index: new Map(),
        songs_index: new Map()
    };

    public add_song(name: string): Song {
        {
            // Check if already exists (not a problem)
            const song_id = this.data.songs_index.get(name);
            if (song_id) {
                return this.data.songs.get(song_id)!;
            }
        }

        const song = new Song(this.data.songs.size + 1, name);
        this.data.songs.set(song.id, song);
        this.data.songs_index.set(name, song.id);
        return song;
    }

    public add_rehersal(date: Date): Rehersal {
        {
            // Check if already exists (not a problem)
            const rehersal_id = this.data.rehersals_index.get(date.getTime());
            if (rehersal_id) {
                const rehersal = this.get_rehersal(rehersal_id);
                if (rehersal) {
                    return rehersal;
                }
            }
        }

        const rehersal = {
            rehersal_id: this.data.rehersals.size + 1,
            date,
            duration_minutes: new Map(),
        };
        this.data.rehersals.set(rehersal.rehersal_id, rehersal);
        this.data.rehersals_index.set(date.getTime(), rehersal.rehersal_id);
        return this.get_rehersal(rehersal.rehersal_id)!;
    }

    public add_song_to_rehersal(rehersal: Rehersal, song_id: number, minutes: number): Status {
        if (!this.data.rehersals.has(rehersal.id())) {
            return Expected.err(`rehersal ${rehersal.id()} not found`);
        }
        if (!this.data.songs.has(song_id)) {
            return Expected.err(`song ${song_id} not found`);
        }
        let rehersal_songs = this.data.rehersal_songs.get(rehersal.id());
        if (!rehersal_songs) {
            rehersal_songs = new Map();
            this.data.rehersal_songs.set(rehersal.id(), rehersal_songs);
        }
        rehersal_songs.set(song_id, minutes);
        return Expected.ok(undefined);
    }

    // voice is needed to update per-part duration_minutes on the rehersal.
    public add_participant_to_rehersal(
        rehersal: Rehersal,
        tgid: string,
        minutes: number,
        voice: Voice,
    ): Status {
        if (!this.data.rehersals.has(rehersal.id())) {
            return Expected.err(`rehersal ${rehersal.id()} not found`);
        }
        let rehersal_participants = this.data.rehersal_participants.get(rehersal.id());
        if (!rehersal_participants) {
            rehersal_participants = new Map();
            this.data.rehersal_participants.set(rehersal.id(), rehersal_participants);
        }
        rehersal_participants.set(tgid, minutes);

        const rehersal_data = this.data.rehersals.get(rehersal.id());
        if (rehersal_data) {
            const duration_minutes = rehersal_data.duration_minutes.get(voice);
            if (duration_minutes == undefined || duration_minutes < minutes) {
                rehersal_data.duration_minutes.set(voice, minutes);
            }
        }
        return Expected.ok(undefined);
    }

    public get_rehersals(): Rehersal[] {
        const rehersals: Rehersal[] = [];
        for (const [rehersal_id, _] of this.data.rehersals) {
            rehersals.push(this.get_rehersal(rehersal_id)!);
        }
        return rehersals;
    }

    public get_rehersals_in_period(since: Date, to: Date): Rehersal[] {
        const rehersals: Rehersal[] = [];
        for (const [rehersal_id, rehersal] of this.data.rehersals) {
            if (rehersal.date >= since && rehersal.date < to) {
                rehersals.push(this.get_rehersal(rehersal_id)!);
            }
        }
        return rehersals;
    }

    public get_rehersal(rehersal_id: number): Rehersal | undefined {
        const rehersal_data = this.data.rehersals.get(rehersal_id);
        if (!rehersal_data) {
            return undefined;
        }
        return new Rehersal(this, rehersal_data);
    }

    // Earliest rehersal where the user had positive presence minutes.
    public first_presence_date(tgid: string): Date | undefined {
        let first: Date | undefined;
        for (const rehersal of this.get_rehersals()) {
            if (rehersal.minutes_of_presence(tgid) <= 0) {
                continue;
            }
            const when = rehersal.when();
            if (!first || when < first) {
                first = when;
            }
        }
        return first;
    }

    public lowlevel(): Data { return this.data; }
}
