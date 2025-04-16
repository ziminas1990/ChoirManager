import { Config } from "@src/config.js";
import { Database } from "@src/database.js";
import { IRehersalsStorage, RehersalInfo } from "@src/interfaces/rehersals_storage.js";
import { Journal } from "@src/journal.js";
import { Status } from "@src/status.js";


export class RehersalsTracker {
    private journal: Journal;

    private next_fetch: Date;
    private fetch_promise?: Promise<void>;

    constructor(
        private rehersals_storage: IRehersalsStorage,
        private database: Database,
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
            return Status.ok();
        }
        if (this.fetch_promise) {
            return Status.ok();
        }
        // We don't want main thread to be blocked by fetch_rehersals() call, so we just
        // create a promise and return Status.ok() immediately.
        this.fetch_promise = new Promise(async (resolve) => {
            const status = await this.fetch_rehersals();
            this.fetch_promise = undefined;
            if (!status.ok()) {
                this.journal.log().error(`Failed to fetch rehersals: ${status.what()}`);
            }
            resolve();
        });
        return Status.ok();
    }

    private async fetch_rehersals(): Promise<Status> {
        if (!Config.data.rehersals_tracker) {
            return Status.fail("'rehersals_tracker' is not specified");
        }
        const fetch_interval_sec = Config.data.rehersals_tracker.fetch_interval_sec;

        const rehersals = await this.rehersals_storage.fetch();
        if (rehersals.ok()) {
            this.update_database(rehersals.value!);
            this.next_fetch = new Date(Date.now() + fetch_interval_sec * 1000);
            return Status.ok();
        } else {
            this.next_fetch = new Date(Date.now() + fetch_interval_sec / 10 * 1000);
            return rehersals.wrap("can't fetch rehersals");
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
                this.database.add_participant_to_rehersal(rehersal, tgid, minutes);
            }
        }
    }
}