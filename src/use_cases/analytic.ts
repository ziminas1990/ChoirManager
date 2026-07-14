import { Database, Rehersal } from "@src/database.js";
import {
    ChoristerActivityPeriod,
    ChoristerActivityStat,
    ChoristerAttendanceStat,
} from "@src/entities/statistics.js";
import { Expected } from "@src/utils/expected.js";

function accumulate_songs_stat(
    songs: { name: string, minutes: number }[],
    accumulator: Map<string, number>
) {
    songs.forEach(({ name, minutes }) => {
        accumulator.set(name, (accumulator.get(name) ?? 0) + minutes);
    });
}

function days_between(from: Date, to: Date): number {
    return (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
}

// Returns the number of most recent rehearsals skipped in a row within the period.
function count_last_skipped_rehersals(
    user_id: string,
    rehersals_newest_first: Rehersal[],
): number {
    let count = 0;
    for (const rehersal of rehersals_newest_first) {
        if (rehersal.minutes_of_presence(user_id) <= 0) {
            count++;
        } else {
            return count;
        }
    }
    return count;
}

function split_into_periods(
    visits: Date[],
    max_gap_days: number,
    now: Date,
): ChoristerActivityPeriod[] {
    const periods: ChoristerActivityPeriod[] = [];
    let begin = visits[0];
    let last = visits[0];

    for (let i = 1; i < visits.length; i++) {
        const visit = visits[i];
        if (days_between(last, visit) >= max_gap_days) {
            periods.push({ begin, end: last });
            begin = visit;
        }
        last = visit;
    }

    if (days_between(last, now) >= max_gap_days) {
        periods.push({ begin, end: last });
    } else {
        periods.push({ begin });
    }
    return periods;
}

export class Analytic {

    // Returns activity statistics for all choristers who visited at least one
    // rehersal. Activity is a set of intervals where the chorister was active
    // (visited rehersals). If the gap between visits is at least 'max_gap_days',
    // the previous interval is closed and a new one is opened. The last
    // interval has no 'end' while the chorister is still considered active
    // (fewer than 'max_gap_days' since the last visit).
    static choristers_activity(
        database: Database,
        max_gap_days: number): Map<string, ChoristerActivityStat>
    {
        const now = new Date();
        const rehersals = database.get_rehersals()
            .sort((a, b) => a.when().getTime() - b.when().getTime());

        const visits_by_user = new Map<string, Date[]>();
        for (const rehersal of rehersals) {
            const when = rehersal.when();
            for (const tgid of rehersal.present_participants()) {
                let visits = visits_by_user.get(tgid);
                if (!visits) {
                    visits = [];
                    visits_by_user.set(tgid, visits);
                }
                visits.push(when);
            }
        }

        const result = new Map<string, ChoristerActivityStat>();
        for (const [tgid, visits] of visits_by_user) {
            const periods = split_into_periods(visits, max_gap_days, now);
            result.set(tgid, {
                first_joined: periods[0].begin,
                last_active_since: periods[periods.length - 1].begin,
                periods,
            });
        }
        return result;
    }

    static chorister_statistic_request(
        database: Database,
        user_id: string,
        begin: Date,
        end: Date,
    ): Expected<ChoristerAttendanceStat>
    {
        const user = database.get_user(user_id);
        if (!user) {
            return Expected.err(`User ${user_id} not found`);
        }

        // Accumulating actual statistic during the whole period
        const rehersals = database.get_rehersals_in_period(begin, end);
        let actual_minutes = 0;
        let actual_rehersals = 0;
        let first_rehersal: Date = user.join_date ?? end;
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

        const rehersals_newest_first = [...rehersals]
            .sort((a, b) => b.when().getTime() - a.when().getTime());

        return Expected.ok({
            period: {
                from: first_rehersal,
                to: end
            },
            total_rehersals: ideal_rehersals,
            total_hours: ideal_minutes / 60,
            visited_rehersals: actual_rehersals,
            last_skipped_rehersals: count_last_skipped_rehersals(
                user_id, rehersals_newest_first),
            visited_hours: actual_minutes / 60,
            songs: songs_stat
        });
    }

}