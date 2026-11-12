import { Role, UserData, Voice, user_has_role } from "@src/entities/user.js";
import {
    ActivityRequest, AttendanceReport, ChoristerActivityPeriod, ChoristerActivityStat,
    ChoristerAttendanceEntry, ChoristerAttendanceStat, ChoristerStatisticsRequest,
    IAnalyticService, MonthlyAttendanceReport, MonthlyAttendanceRequest,
    ReportChorister, ReportPeriod,
} from "@src/interfaces/analytic_service.js";
import { AnalyticRehearsal, AnalyticSnapshot, IAnalyticSource } from "@src/interfaces/analytic_source.js";
import { Expected } from "@src/utils/expected.js";

export class AnalyticService implements IAnalyticService {
    constructor(private readonly source: IAnalyticSource) {}

    async chorister_statistic_request(request: ChoristerStatisticsRequest)
    : Promise<Expected<ChoristerAttendanceStat>>
    {
        try {
            const period = Helpers.period(request);
            if (!period.ok) {
                return period.cast_error();
            }

            const snapshot = this.source.snapshot();
            const user = snapshot.users.find(user => user.id.system_id === request.system_id);
            if (!user) {
                return Expected.err("Chorister not found");
            }

            return Expected.ok(this.personal_statistics(snapshot.rehearsals, user, period.value));
        } catch (error) {
            return Expected.exception("Failed to calculate personal statistics", error);
        }
    }

    async choristers_activity(request: ActivityRequest)
    : Promise<Expected<ChoristerActivityStat[]>>
    {
        try {
            // Validate the inactivity gap and reference time.
            const now = request.as_of ?? new Date();
            if (!Number.isFinite(request.max_gap_days) || request.max_gap_days <= 0
                || !Number.isFinite(now.getTime())) {
                return Expected.err("Activity requires a positive inactivity gap and valid as_of date");
            }

            // Collect positive visits in chronological order up to the reference time.
            const snapshot = this.source.snapshot();
            const visits = new Map<string, Date[]>();
            for (const rehearsal of [...snapshot.rehearsals].sort(Helpers.by_date)) {
                if (rehearsal.when > now) {
                    continue;
                }
                for (const participant of rehearsal.participants) {
                    if (participant.minutes <= 0) {
                        continue;
                    }

                    const dates = visits.get(participant.tg_username) ?? [];
                    dates.push(rehearsal.when);
                    visits.set(participant.tg_username, dates);
                }
            }

            // Build activity intervals and retain participants without a matching profile.
            const result: ChoristerActivityStat[] = [];
            for (const [tg_username, dates] of visits) {
                const periods = this.activity_periods(dates, request.max_gap_days, now);
                const user = snapshot.users.find(user => user.id.tg_username === tg_username);
                result.push({
                    system_id: user?.id.system_id ?? null, tg_username,
                    first_joined: periods[0].begin,
                    last_active_since: periods[periods.length - 1].begin, periods,
                });
            }

            return Expected.ok(result);
        } catch (error) {
            return Expected.exception("Failed to calculate activity", error);
        }
    }

    async build_attendance_report(request: ReportPeriod)
    : Promise<Expected<AttendanceReport>>
    {
        try {
            const period = Helpers.period(request);
            if (!period.ok) {
                return period.cast_error();
            }

            // Calculate personal statistics from the same snapshot for every chorister.
            const snapshot = this.source.snapshot();
            const choristers = this.attendance_entries(snapshot, period.value);

            // Preserve the legacy reminder threshold and ordering.
            return Expected.ok({
                period: period.value, choristers,
                low_attendance: choristers.filter(entry => entry.reminder_percent < 60)
                    .sort((left, right) => right.reminder_percent - left.reminder_percent),
            });
        } catch (error) {
            return Expected.exception("Failed to calculate attendance report", error);
        }
    }

    async build_monthly_attendance_report(request: MonthlyAttendanceRequest)
    : Promise<Expected<MonthlyAttendanceReport>>
    {
        try {
            // Validate the calendar month and explicit leader selection mode.
            if (!Number.isInteger(request.year) || request.year < 1 || request.year > 9998
                || !Number.isInteger(request.month) || request.month < 1 || request.month > 12
                || !["above_80_percent", "top_three"].includes(request.leader_mode)) {
                return Expected.err("Invalid calendar month or leader mode");
            }

            // Use UTC month boundaries, including the transition to the next year.
            const start = new Date(0);
            start.setUTCFullYear(request.year, request.month - 1, 1);
            const end = new Date(start);
            end.setUTCMonth(end.getUTCMonth() + 1);
            const period = { from: start, to: end };

            // Exclude unfilled date columns from the monthly calculation.
            const snapshot = this.source.snapshot();
            snapshot.rehearsals = snapshot.rehearsals.filter(rehearsal =>
                rehearsal.participants.some(item => item.minutes > 0)
                || rehearsal.songs.some(item => item.minutes > 0));
            const rehearsals = snapshot.rehearsals.filter(rehearsal =>
                Helpers.in_period(rehearsal, period));

            // Calculate individual attendance and accumulate piece times for this month.
            const entries = this.attendance_entries(snapshot, period);
            const pieces = new Map<string, number>();
            for (const rehearsal of rehearsals) Helpers.accumulate_songs(rehearsal.songs, pieces);

            // Champions must attend their part's rehearsals over the whole month.
            // Do not shorten this requirement to a newcomer's first visit.
            const champions = entries
                .filter(entry => {
                    const part_rehearsals = this.rehearsals_for_voice(
                        rehearsals, entry.chorister.voice);
                    return part_rehearsals.length > 0
                        && entry.statistics.visited_rehersals === part_rehearsals.length;
                })
                .map(entry => entry.chorister)
                .sort((left, right) => Helpers.compare_ids(left.system_id, right.system_id));

            // Calculate averages and leaders separately for each voice part.
            const parts = Object.values(Voice).map(voice => {
                // Exclude choristers whose expected time is zero.
                const eligible = entries.filter(entry => entry.chorister.voice === voice
                    && entry.statistics.attendance_percent !== null);

                // Rank unrounded percentages, resolving ties by system ID.
                const ranked = eligible.map(entry => ({
                    chorister: entry.chorister,
                    attendance_percent: entry.statistics.attendance_percent!,
                })).sort((left, right) => right.attendance_percent - left.attendance_percent
                    || Helpers.compare_ids(left.chorister.system_id, right.chorister.system_id));

                // Apply the requested mode without adapting it to the number of leaders.
                return {
                    voice,
                    average_attendance_percent: eligible.length === 0 ? null
                        : ranked.reduce((sum, entry) => sum + entry.attendance_percent, 0) / eligible.length,
                    eligible_choristers: eligible.length,
                    leaders: request.leader_mode === "top_three" ? ranked.slice(0, 3)
                        : ranked.filter(entry => entry.attendance_percent > 80),
                };
            });

            // Count each rehearsal's duration once, without summing voice-part durations.
            return Expected.ok({
                year: request.year,
                month: request.month,
                leader_mode: request.leader_mode,
                timezone: "UTC",
                period,
                total_rehersals: rehearsals.length,
                total_hours: rehearsals.reduce((sum, rehearsal) => sum
                    + Math.max(0, ...Object.values(rehearsal.duration_minutes)), 0) / 60,
                pieces: Array.from(pieces, ([name, minutes]) => ({ name, minutes }))
                    .sort((left, right) => right.minutes - left.minutes || Helpers.compare_ids(left.name, right.name)),
                champions,
                parts,
            });
        } catch (error) {
            return Expected.exception("Failed to calculate monthly attendance report", error);
        }
    }

    private personal_statistics(
        all_rehearsals: AnalyticRehearsal[], user: UserData, period: ReportPeriod,
    ): ChoristerAttendanceStat {
        // Match presence by the current username, including visits outside the period.
        const presence = (rehearsal: AnalyticRehearsal): number => user.id.tg_username
            ? rehearsal.participants.find(item => item.tg_username === user.id.tg_username)?.minutes ?? 0 : 0;

        // Expected attendance starts at the first positive visit in the entire history.
        const first_presence = all_rehearsals.filter(rehearsal => presence(rehearsal) > 0)
            .sort(Helpers.by_date)[0]?.when ?? period.to;

        // Every attendance measure uses the same rehearsals for this chorister.
        const rehearsals = this.rehearsals_for_voice(all_rehearsals, user.voice)
            .filter(rehearsal => Helpers.in_period(rehearsal, period)
                && rehearsal.when >= first_presence);

        // Accumulate actual and expected attendance, including time spent on pieces.
        let actual_minutes = 0;
        let actual_rehersals = 0;
        let ideal_minutes = 0;
        let period_from = period.to;
        const actual_songs = new Map<string, number>();
        const ideal_songs = new Map<string, number>();
        for (const rehearsal of rehearsals) {
            // Any positive presence credits all piece time from this rehearsal.
            const minutes = presence(rehearsal);
            if (minutes > 0) {
                actual_minutes += minutes;
                actual_rehersals++;
                Helpers.accumulate_songs(rehearsal.songs, actual_songs);
            }

            // The filtered rehearsals all contribute expected time for this part.
            ideal_minutes += rehearsal.duration_minutes[user.voice] ?? 0;
            Helpers.accumulate_songs(rehearsal.songs, ideal_songs);
            if (rehearsal.when < period_from) {
                period_from = rehearsal.when;
            }
        }

        // Count only relevant consecutive absences after the first recorded visit.
        let skipped = 0;
        for (const rehearsal of [...rehearsals].sort((left, right) => -Helpers.by_date(left, right))) {
            if (presence(rehearsal) > 0) {
                break;
            }
            skipped++;
        }

        // Return unrounded percentages; null denotes missing expected time.
        return {
            period: { from: period_from, to: period.to },
            total_rehersals: rehearsals.length,
            visited_rehersals: actual_rehersals,
            last_skipped_rehersals: skipped,
            total_hours: ideal_minutes / 60,
            visited_hours: actual_minutes / 60,
            attendance_percent: ideal_minutes > 0 ? actual_minutes / ideal_minutes * 100 : null,
            songs: Array.from(ideal_songs, ([name, ideal]) => ({
                name,
                ideal,
                actual: actual_songs.get(name) ?? 0,
                attendance_percent: ideal > 0 ? (actual_songs.get(name) ?? 0) / ideal * 100 : null,
            })).sort((left, right) => right.actual - left.actual),
        };
    }

    private rehearsals_for_voice(rehearsals: AnalyticRehearsal[], voice: Voice)
    : AnalyticRehearsal[]
    {
        // The source infers a part's duration from positive participant presence.
        return rehearsals.filter(rehearsal => (rehearsal.duration_minutes[voice] ?? 0) > 0);
    }

    private attendance_entries(snapshot: AnalyticSnapshot, period: ReportPeriod)
    : ChoristerAttendanceEntry[]
    {
        // Group reports include current choristers with an attendance username.
        return snapshot.users
            .filter(user => user_has_role(user, Role.Chorister) && user.id.tg_username)
            .map(user => {
                // Keep profile data and statistics together for report consumers.
                const statistics = this.personal_statistics(snapshot.rehearsals, user, period);
                const chorister: ReportChorister = {
                    system_id: user.id.system_id, tg_username: user.id.tg_username ?? null,
                    name: user.name, surname: user.surname, voice: user.voice,
                };

                // Reminders retain their rounded-up percentage and zero-time fallback.
                return {
                    chorister,
                    statistics,
                    reminder_percent: statistics.total_hours > 0
                        ? Math.ceil(statistics.visited_hours / statistics.total_hours * 100) : 0
                };
            });
    }

    private activity_periods(visits: Date[], max_gap_days: number, now: Date)
    : ChoristerActivityPeriod[]
    {
        // Start the first interval at the earliest visit.
        const periods: ChoristerActivityPeriod[] = [];
        const gap = max_gap_days * 86400_000;
        let begin = visits[0];
        let last = visits[0];

        // A sufficiently long gap closes the old interval and starts another.
        for (const visit of visits.slice(1)) {
            if (visit.getTime() - last.getTime() >= gap) {
                periods.push({ begin, end: last });
                begin = visit;
            }
            last = visit;
        }

        // Leave the final interval open only while the chorister is still active.
        periods.push(now.getTime() - last.getTime() >= gap ? { begin, end: last } : { begin });
        return periods;
    }
}

class Helpers {
    static period(request: ReportPeriod): Expected<ReportPeriod> {
        if (!(request.from instanceof Date) || !(request.to instanceof Date)
            || !Number.isFinite(request.from.getTime()) || !Number.isFinite(request.to.getTime())
            || request.from > request.to) {
            return Expected.err("Invalid report period");
        }

        // Detach the report period from the caller's mutable Date objects.
        return Expected.ok({ from: new Date(request.from), to: new Date(request.to) });
    }

    static in_period(rehearsal: AnalyticRehearsal, period: ReportPeriod): boolean {
        return rehearsal.when >= period.from && rehearsal.when < period.to;
    }

    static by_date(left: AnalyticRehearsal, right: AnalyticRehearsal): number {
        return left.when.getTime() - right.when.getTime();
    }

    static compare_ids(left: string, right: string): number {
        return left < right ? -1 : left > right ? 1 : 0;
    }

    static accumulate_songs(songs: { name: string; minutes: number }[], accumulator: Map<string, number>): void {
        for (const { name, minutes } of songs) accumulator.set(name, (accumulator.get(name) ?? 0) + minutes);
    }
}
