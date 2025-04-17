import { Database } from "@src/database.js";
import { ChoristerStatistics } from "@src/entities/statistics.js";
import { StatusWith } from "@src/status";
import { IUserAgent } from "@src/interfaces/user_agent.js";
import { Runtime } from "@src/runtime.js";
import { Status } from "@src/status.js";
import { apply_interval } from "@src/utils.js";

export class Analytic {

    static chorister_statistic_request(agent: IUserAgent, days: number)
    : StatusWith<ChoristerStatistics>
    {
        const now = new Date();
        const since = new Date();
        apply_interval(since, { days: -days });

        const database: Database = Runtime.get_instance().get_database();

        const user_id = agent.userid();
        const user = database.get_user(user_id);
        if (!user) {
            return Status.fail(`User ${user_id} not found`);
        }

        // Total number of rehersals that chorister has visited
        const rehersals = database.get_rehersals_in_period(since, now);
        let visited_minutes = 0;
        let visited_rehersals = 0;
        let first_rehersal: Date = now;
        rehersals.forEach(rehersal => {
            const minutes = rehersal.minutes_of_presence(user_id);
            if (minutes > 0) {
                visited_minutes += minutes;
                visited_rehersals++;
                if (first_rehersal > rehersal.when()) {
                    first_rehersal = rehersal.when();
                }
            }
        });

        // Total number of minutes of rehersals that choristed would have visited,
        // if he would have visited all rehersals since first_rehersal
        let rehersals_minutes = 0;
        let total_rehersals = 0;
        rehersals.forEach(rehersal => {
            if (rehersal.when() >= first_rehersal) {
                rehersals_minutes += rehersal.duration(user.voice);
                total_rehersals++;
            }
        });

        return Status.ok().with({
            period: {
                from: since,
                to: now
            },
            total_rehersals: total_rehersals,
            total_hours: rehersals_minutes / 60,
            visited_rehersals: visited_rehersals,
            visited_hours: visited_minutes / 60
        });
    }

}