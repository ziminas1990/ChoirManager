import { UserData, Voice } from "@src/entities/user.js";

// Detached input captured in one synchronous read of the local replicas.
export type AnalyticRehearsal = {
    when: Date;
    duration_minutes: Partial<Record<Voice, number>>;
    participants: { tg_username: string; minutes: number }[];
    songs: { name: string; minutes: number }[];
};

export type AnalyticSnapshot = { users: UserData[]; rehearsals: AnalyticRehearsal[] };

// Local dependency, not a remotely exposed service contract.
export interface IAnalyticSource {
    snapshot(): AnalyticSnapshot;
}
