import { Database } from "@src/database.js";
import { ChoristerStatistics } from "@src/entities/statistics.js";
import { StatusWith } from "@src/status";
import { Runtime } from "@src/runtime.js";
import { Status } from "@src/status.js";
import { apply_interval } from "@src/utils.js";

function accumulate_songs_stat(
    songs: { name: string, minutes: number }[],
    accumulator: Map<string, number>
) {
    songs.forEach(({ name, minutes }) => {
        accumulator.set(name, (accumulator.get(name) ?? 0) + minutes);
    });
}

export class Analytic {

    static chorister_statistic_request(user_id: string, days: number | undefined)
    : StatusWith<ChoristerStatistics>
    {
        const now = new Date();
        let since: Date | undefined;
        if (days) {
            since = apply_interval(new Date(), { days: -days });
        }

        const database: Database = Runtime.get_instance().get_database();

        const user = database.get_user(user_id);
        if (!user) {
            return Status.fail(`User ${user_id} not found`);
        }

        // Accumulating actual statistic during the whole period
        const rehersals = since ?
            database.get_rehersals_in_period(since, now) :
            database.get_rehersals();
        let actual_minutes = 0;
        let actual_rehersals = 0;
        let first_rehersal: Date = now;
        const actual_songs = new Map<string, number>();
        rehersals.forEach(rehersal => {
            const minutes = rehersal.minutes_of_presence(user_id);
            if (minutes > 0) {
                actual_minutes += minutes;
                actual_rehersals++;
                if (first_rehersal > rehersal.when()) {
                    first_rehersal = rehersal.when();
                }
                accumulate_songs_stat(rehersal.songs(), actual_songs);
            }
        });

        // Accumulating ideal statistic since first visited rehersal
        let ideal_minutes = 0;
        let ideal_rehersals = 0;
        const ideal_songs = new Map<string, number>();
        rehersals.forEach(rehersal => {
            if (rehersal.when() >= first_rehersal) {
                ideal_minutes += rehersal.duration(user.voice);
                ideal_rehersals++;
                accumulate_songs_stat(rehersal.songs(), ideal_songs);
            }
        });

        const songs_stat = new Map<string, { ideal: number, actual: number }>();
        ideal_songs.forEach((ideal, name) => {
            songs_stat.set(name, { ideal, actual: actual_songs.get(name) ?? 0 });
        });

        return Status.ok().with({
            period: {
                from: first_rehersal,
                to: now
            },
            total_rehersals: ideal_rehersals,
            total_hours: ideal_minutes / 60,
            visited_rehersals: actual_rehersals,
            visited_hours: actual_minutes / 60,
            songs: songs_stat
        });
    }

}