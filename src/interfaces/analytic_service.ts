import { Voice } from "@src/entities/user.js";
import { Expected } from "@src/utils/expected.js";

// Dates use Date objects; transport adapters encode and restore them.
// Percentages are in [0, 100] for consistent source data.
// A null percentage means no expected time.
export type ReportPeriod = { from: Date; to: Date };
export type ReportChorister = {
    system_id: string;
    tg_username: string | null;
    name: string;
    surname: string;
    voice: Voice;
};

export type ChoristerActivityPeriod = { begin: Date; end?: Date };
export type ChoristerActivityStat = {
    system_id: string | null;
    tg_username: string;
    first_joined: Date;
    last_active_since: Date;
    periods: ChoristerActivityPeriod[];
};

// All attendance measures use rehearsals with positive duration for the current
// voice, within the requested period and since the first recorded visit.
export type ChoristerAttendanceStat = {
    period: ReportPeriod;
    total_rehersals: number;
    visited_rehersals: number;
    last_skipped_rehersals: number;
    total_hours: number;
    visited_hours: number;
    attendance_percent: number | null;
    songs: { name: string; ideal: number; actual: number; attendance_percent: number | null }[];
};

export type ChoristerAttendanceEntry = {
    chorister: ReportChorister;
    statistics: ChoristerAttendanceStat;
    // Legacy reminder percentage: rounded up, or zero without expected time.
    reminder_percent: number;
};

export type AttendanceReport = {
    period: ReportPeriod;
    choristers: ChoristerAttendanceEntry[];
    low_attendance: ChoristerAttendanceEntry[];
};

export type AttendanceLeaderMode = "above_80_percent" | "top_three";
export type MonthlyAttendanceReport = {
    year: number;
    month: number;
    timezone: "UTC";
    period: ReportPeriod;
    leader_mode: AttendanceLeaderMode;
    total_rehersals: number;
    total_hours: number;
    pieces: { name: string; minutes: number }[];
    // Every rehearsal of the chorister's part over the whole month, before
    // applying the first-visit adjustment. A part with no rehearsals has no champion.
    champions: ReportChorister[];
    parts: {
        voice: Voice;
        average_attendance_percent: number | null;
        eligible_choristers: number;
        leaders: { chorister: ReportChorister; attendance_percent: number }[];
    }[];
};

export type ChoristerStatisticsRequest = ReportPeriod & { system_id: string };
export type ActivityRequest = { max_gap_days: number; as_of?: Date };
export type MonthlyAttendanceRequest = {
    year: number;
    // Calendar month, 1 through 12. Boundaries use UTC.
    month: number;
    leader_mode: AttendanceLeaderMode;
};

export interface IAnalyticService {

    chorister_statistic_request(request: ChoristerStatisticsRequest)
    : Promise<Expected<ChoristerAttendanceStat>>;

    choristers_activity(request: ActivityRequest)
    : Promise<Expected<ChoristerActivityStat[]>>;

    build_attendance_report(request: ReportPeriod)
    : Promise<Expected<AttendanceReport>>;

    build_monthly_attendance_report(request: MonthlyAttendanceRequest)
    : Promise<Expected<MonthlyAttendanceReport>>;
}
