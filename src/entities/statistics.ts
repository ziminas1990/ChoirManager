export type ChoristerActivityPeriod = {
    begin: Date;
    end?: Date;  // if empty, then active by now
}

export type ChoristerActivityStat = {
    first_joined: Date;         // begin of the first active period
    last_active_since: Date;    // begin of the last active period
    periods: ChoristerActivityPeriod[];
}

export type ChoristerAttendanceStat = {
    period: {
        from: Date;
        to: Date;
    };
    total_rehersals: number;
    visited_rehersals: number;
    // Total number of rehersals skipped in a raw. If 'N', it means that the chorister
    // skipped N last rehersals.
    last_skipped_rehersals: number;
    total_hours: number;
    visited_hours: number;
    songs: Map<string, {
        ideal: number;
        actual: number;
    }>;
}
