
export type ChoristerStatistics = {
    period: {
        from: Date;
        to: Date;
    };
    total_rehersals: number;
    visited_rehersals: number;
    total_hours: number;
    visited_hours: number;
    songs: Map<string, {
        ideal: number;
        actual: number;
    }>;
}
