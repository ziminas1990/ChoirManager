import { Database } from "@src/database.js";
import { IRehersalsStorage, RehersalInfo } from "@src/interfaces/rehersals_storage.js";
import { Journal } from "@src/journal.js";
import { Status } from "@src/status.js";


export class RehersalsTracker {
    private journal: Journal;

    constructor(
        private rehersals_storage: IRehersalsStorage,
        private database: Database,
        parent_journal: Journal)
    {
        this.journal = parent_journal.child("rehersals_tracker");
    }

    async init(): Promise<Status> {
        this.journal.log().info("Initializing rehersals tracker...");
        const rehersals = await this.rehersals_storage.get_rehersals();
        this.update_database(rehersals);
        return Status.ok();
    }

    private update_database(rehersals: RehersalInfo[]) {
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