import { AnalyticService } from "@src/components/analytic_service.js";
import { Database } from "@src/database.js";
import { Voice } from "@src/entities/user.js";
import { AnalyticSnapshot, IAnalyticSource } from "@src/interfaces/analytic_source.js";
import { IUserServiceReplica } from "@src/interfaces/user_service.js";
import { Expected, Status } from "@src/utils/expected.js";

export type AnalyticServiceConfigJson = { type: "local" };

export class AnalyticServiceConfig {
    constructor(private readonly json: AnalyticServiceConfigJson) {}

    get type(): "local" { return this.json.type; }

    verify(): Status {
        return this.type === "local"
            ? Expected.ok(undefined) : Expected.err("Analytic service type must be local");
    }
}

export class AnalyticServiceFactory {
    static create(
        config: AnalyticServiceConfig,
        database: Database,
        users: IUserServiceReplica,
    ): Expected<AnalyticService> {
        const status = config.verify();
        if (!status.ok) {
            return status.cast_error();
        }
        return Expected.ok(new AnalyticService(new LocalAnalyticSource(database, users)));
    }
}

class LocalAnalyticSource implements IAnalyticSource {
    constructor(private readonly database: Database, private readonly users: IUserServiceReplica) {}

    snapshot(): AnalyticSnapshot {
        return {
            users: structuredClone(this.users.fetch_all()),
            rehearsals: this.database.get_rehersals().map(rehearsal => ({
                when: rehearsal.when(),
                duration_minutes: Object.fromEntries(
                    Object.values(Voice).map(voice => [voice, rehearsal.duration(voice)])),
                participants: rehearsal.present_participants().map(tg_username => ({
                    tg_username, minutes: rehearsal.minutes_of_presence(tg_username),
                })),
                songs: rehearsal.songs().map(song => ({ ...song })),
            })),
        };
    }
}
