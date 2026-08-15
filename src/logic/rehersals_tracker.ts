import { Database } from "@src/database.js";
import { Voice } from "@src/entities/user.js";
import { IRehersalsStorage, RehersalInfo } from "@src/interfaces/rehersals_storage.js";
import { IUserServiceReplica } from "@src/interfaces/user_service.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";

export type RehersalsTrackerConfigJson = {
    fetch_interval_sec: number;
}

export class RehersalsTrackerConfig {
    constructor(private readonly json: RehersalsTrackerConfigJson) {}

    get fetch_interval_sec(): number {
        return this.json.fetch_interval_sec;
    }

    verify(): Status {
        if (!this.json.fetch_interval_sec) {
            return Expected.err("'fetch_interval_sec' MUST be specified");
        }
        if (this.json.fetch_interval_sec < 10) {
            return Expected.err("'fetch_interval_sec' MUST be at least 10 seconds");
        }
        return Expected.ok(undefined);
    }
}


export class RehersalsTracker {
    private journal: Journal;

    private next_fetch: Date;
    private fetch_promise?: Promise<void>;

    constructor(
        private readonly config: RehersalsTrackerConfig,
        private rehersals_storage: IRehersalsStorage,
        private database: Database,
        private readonly users: IUserServiceReplica,
        parent_journal: Journal)
    {
        this.next_fetch = new Date();
        this.journal = parent_journal.child("rehersals_tracker");
    }

    async init(): Promise<Status> {
        this.journal.log().info("Initializing rehersals tracker...");
        return this.fetch_rehersals();
    }

    public async proceed(now: Date): Promise<Status> {
        if (now < this.next_fetch) {
            return Expected.ok(undefined);
        }
        if (this.fetch_promise) {
            return Expected.ok(undefined);
        }
        // We don't want main thread to be blocked by fetch_rehersals() call, so we just
        // create a promise and return Expected.ok(undefined) immediately.
        this.fetch_promise = new Promise(async (resolve) => {
            const status = await this.fetch_rehersals();
            this.fetch_promise = undefined;
            if (!status.ok) {
                this.journal.log().error(`Failed to fetch rehersals: ${status.error}`);
            }
            resolve();
        });
        return Expected.ok(undefined);
    }

    private async fetch_rehersals(): Promise<Status> {
        const fetch_interval_sec = this.config.fetch_interval_sec;

        const rehersals = await this.rehersals_storage.fetch();
        if (rehersals.ok) {
            this.update_database(rehersals.value!);
            this.next_fetch = new Date(Date.now() + fetch_interval_sec * 1000);
            return Expected.ok(undefined);
        } else {
            this.next_fetch = new Date(Date.now() + fetch_interval_sec / 10 * 1000);
            return rehersals.wrap_error("can't fetch rehersals");
        }
    }

    private update_database(rehersals: RehersalInfo[]) {
        this.journal.log().info(`Updating database with ${rehersals.length} rehersals`);
        // Add rehersals data to database
        for (const { date, songs, participants } of rehersals) {
            const rehersal = this.database.add_rehersal(date);
            for (const { name, minutes } of songs) {
                const song = this.database.add_song(name);
                this.database.add_song_to_rehersal(rehersal, song.id, minutes);
            }
            for (const { tgid, minutes } of participants) {
                this.database.add_participant_to_rehersal(
                    rehersal, tgid, minutes, this.resolve_voice(tgid));
            }
        }
    }

    private resolve_voice(tgid: string): Voice {
        const resolved = this.users.resolve_user({ tg_username: tgid });
        if (!resolved.ok || !resolved.value) {
            return Voice.Unknown;
        }
        return resolved.value.voice;
    }
}