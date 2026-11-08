import { Score } from "@src/entities/score.js";
import { Role, user_has_role } from "@src/entities/user.js";
import { Environment } from "@src/components/environment.js";
import { IScoresService } from "@src/interfaces/scores_service.js";
import { IUserAgent } from "@src/interfaces/user_agent.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";
import { GlobalFormatter, return_fail } from "@src/utils.js";

export enum ScoresError {
    AccessDenied = 1,
    Unavailable,
    NotFound,
}

export class ScoresActions {

    static async get_available_scores(
        agent: IUserAgent,
        journal: Journal,
    ): Promise<Score[] | Status> {
        const access = await this.check_scores_access(agent, journal);
        if (!access.ok) {
            return access.as_status();
        }

        return (await access.value.fetch_all())
            .filter(score => !!score.file)
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    static async search_scores(
        agent: IUserAgent,
        query: string,
        journal: Journal,
    ): Promise<Expected<Score[]>> {
        const access = await this.check_scores_access(agent, journal);
        if (!access.ok) {
            return access.cast_error<Score[]>();
        }

        const searched = await access.value.search(query);
        if (!searched.ok) {
            return searched.wrap_error("scores search failed");
        }

        return Expected.ok(
            searched.value
                .filter(score => !!score.file)
                .sort((a, b) => a.name.localeCompare(b.name)),
        );
    }

    static async scores_list_requested(
        agent: IUserAgent,
        journal: Journal
    ): Promise<Status> {
        const scores = await this.get_available_scores(agent, journal);
        if (!Array.isArray(scores)) {
            return scores;
        }

        return await agent.as_chorister().send_scores_list(scores);
    }

    static async download_scores_request(
        agent: IUserAgent,
        score: Score | string | { id: string },
        journal: Journal
    ): Promise<Status> {
        const access = await this.check_scores_access(agent, journal);
        if (!access.ok) {
            return access.as_status();
        }

        const service = access.value;
        let current: Score | undefined;
        if (typeof score == "string") {
            const catalog = await service.fetch_all();
            current = catalog.find(s => s.name === score)
                ?? catalog.find(s => s.file === score);
        } else if (score instanceof Score) {
            const found = await service.get(score.get_key());
            if (!found.ok) {
                return found.as_status().set_error_code(ScoresError.Unavailable);
            }
            current = found.value;
        } else {
            const catalog = await service.fetch_all();
            current = catalog.find(s => s.get_id() === score.id);
        }

        if (!current?.file) {
            return return_fail("requested score is no longer available", journal.log())
                .set_error_code(ScoresError.NotFound);
        }

        return (await agent.send_message(GlobalFormatter.instance().link(
            `"${current.name}" by ${current.author}`,
            current.file))).as_status();
    }

    private static async check_scores_access(
        agent: IUserAgent,
        journal: Journal,
    ): Promise<Expected<IScoresService>> {
        const userid = agent.userid();
        const resolved = await Environment.global.user_service.resolve_user({ system_id: userid });
        if (!resolved.ok) {
            return resolved.cast_error<IScoresService>().set_error_code(ScoresError.Unavailable);
        }
        if (!resolved.value) {
            return return_fail<IScoresService>(`user ${userid} not found`, journal.log())
                .set_error_code(ScoresError.AccessDenied);
        }
        if (!user_has_role(resolved.value, [Role.Chorister, Role.Conductor, Role.Manager])) {
            return return_fail<IScoresService>(`user ${userid} has no permissions`, journal.log())
                .set_error_code(ScoresError.AccessDenied);
        }

        const service = Environment.global.maybe_scores_service;
        if (!service) {
            return return_fail<IScoresService>("scores service is not available", journal.log())
                .set_error_code(ScoresError.Unavailable);
        }

        return Expected.ok(service);
    }
}
