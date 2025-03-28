import path from "path";
import fs from "fs";

import { Status } from "@src/status.js";
import { Scores } from "@src/tgbot/database.js";
import { IUserAgent } from "@src/tgbot/interfaces/user_agent.js";
import { Journal } from "@src/tgbot/journal.js";
import { Runtime } from "@src/tgbot/runtime.js";
import { return_exception, return_fail } from "@src/tgbot/utils.js";


const SCORES_DIR = path.join(process.cwd(), 'files/scores');

export class ScoresActions {

    static async scores_list_requested(
        agent: IUserAgent,
        journal: Journal
    ): Promise<Status> {
        const runtime = Runtime.get_instance();
        const userid  = agent.userid();
        const user    = runtime.get_user(userid);
        if (!user) {
            return return_fail(`user ${userid} not found`, journal.log());
        }
        if (user.is_guest()) {
            // Guests are not allowed to access scores
            return return_fail(`user ${userid} is a guest`, journal.log());
        }

        const database = runtime.get_database();

        const scores = [...database.all_scores()]
            .sort((a, b) => a.name.localeCompare(b.name));

        return await agent.send_scores_list(scores);
    }

    static async download_scores_request(
        agent: IUserAgent,
        score: Scores | string,
        journal: Journal
    ): Promise<Status> {

        const runtime = Runtime.get_instance();
        const database = runtime.get_database();

        if (typeof score === "string") {
            const score_info = database.find_scores({ name: score });
            if (!score_info) {
                return return_fail(`score ${score} not found`, journal.log());
            }
            score = score_info;
        }

        if (!score.file) {
            return return_fail(`score ${score.name} has no file`, journal.log());
        }

        const userid = agent.userid();
        const user = Runtime.get_instance().get_user(userid);
        if (!user) {
            return return_fail(`user ${userid} not found`, journal.log());
        }

        if (user.is_guest()) {
            // Guests are not allowed to download scores
            return return_fail(`user ${userid} is a guest`, journal.log());
        }

        try {
            const filepath = path.join(SCORES_DIR, score.file);
            if (!fs.existsSync(filepath)) {
                return return_fail(`score file ${filepath} not found`, journal.log());
            }
            return await agent.send_file(filepath, `Scores for ${score.name}`, "application/pdf");
        } catch (err) {
            return return_exception(err, journal.log());
        }
    }
}

