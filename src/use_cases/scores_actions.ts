import { Status } from "@src/utils/expected.js";
import { Scores } from "@src/database.js";
import { Role, user_has_role } from "@src/entities/user.js";
import { IUserAgent } from "@src/interfaces/user_agent.js";
import { Journal } from "@src/journal.js";
import { Runtime } from "@src/runtime.js";
import { Environment } from "@src/components/environment.js";
import { GlobalFormatter, return_fail } from "@src/utils.js";

export class ScoresActions {

    static async get_available_scores(
        agent: IUserAgent,
        journal: Journal,
    ): Promise<Scores[] | Status> {
        const userid = agent.userid();
        const resolved = await Environment.global.user_service.resolve_user({ telegram_id: userid });
        if (!resolved.ok || !resolved.value) {
            return return_fail(`user ${userid} not found`, journal.log());
        }
        if (user_has_role(resolved.value, Role.Guest)) {
            // Guests are not allowed to access scores
            return return_fail(`user ${userid} is a guest`, journal.log());
        }

        return [...Runtime.get_instance().get_database().all_scores()]
            .filter(score => !!score.file)
            .sort((a, b) => a.name.localeCompare(b.name));
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
        score: Scores | string,
        journal: Journal
    ): Promise<Status> {
        if (typeof score == "string") {
            const database = Runtime.get_instance().get_database();
            const score_info = database.find_scores({ name: score }) ?? database.find_scores({ file: score });
            if (!score_info) {
                return return_fail(`score ${score} not found`, journal.log());
            }
            score = score_info;
        }

        if (!score.file) {
            return return_fail(`score ${score.name} has no file`, journal.log());
        }

        const userid = agent.userid();
        const resolved = await Environment.global.user_service.resolve_user({ telegram_id: userid });
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
}
