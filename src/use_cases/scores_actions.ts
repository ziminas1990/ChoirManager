import { Score } from "@src/entities/score.js";
import { Role, user_has_role } from "@src/entities/user.js";
import { Environment } from "@src/components/environment.js";
import { IScoresService } from "@src/interfaces/scores_service.js";
import { IUserAgent } from "@src/interfaces/user_agent.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";
import { GlobalFormatter, return_fail } from "@src/utils.js";

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
        score: Score | string,
        journal: Journal
    ): Promise<Status> {
        if (typeof score == "string") {
            const service = Environment.global.maybe_scores_service;
            if (!service) {
                return return_fail("scores service is not available", journal.log());
            }
            const catalog = await service.fetch_all();
            const score_info = catalog.find(s => s.name === score)
                ?? catalog.find(s => s.file === score);
            if (!score_info) {
                return return_fail(`score ${score} not found`, journal.log());
            }
            score = score_info;
        }

        if (!score.file) {
            return return_fail(`score ${score.name} has no file`, journal.log());
        }

        const userid = agent.userid();
        const resolved = await Environment.global.user_service.resolve_user({ system_id: userid });
        if (!resolved.ok || !resolved.value) {
            return return_fail(`user ${userid} not found`, journal.log());
        }

        if (user_has_role(resolved.value, Role.Guest)) {
            // Guests are not allowed to download scores
            return return_fail(`user ${userid} is a guest`, journal.log());
        }

        return (await agent.send_message(GlobalFormatter.instance().link(
            `"${score.name}" by ${score.author}`,
            score.file))).as_status();
    }

    private static async check_scores_access(
        agent: IUserAgent,
        journal: Journal,
    ): Promise<Expected<IScoresService>> {
        const userid = agent.userid();
        const resolved = await Environment.global.user_service.resolve_user({ system_id: userid });
        if (!resolved.ok || !resolved.value) {
            return return_fail(`user ${userid} not found`, journal.log());
        }
        if (user_has_role(resolved.value, Role.Guest)) {
            // Guests are not allowed to access scores
            return return_fail(`user ${userid} is a guest`, journal.log());
        }

        const service = Environment.global.maybe_scores_service;
        if (!service) {
            return return_fail("scores service is not available", journal.log());
        }

        return Expected.ok(service);
    }
}
