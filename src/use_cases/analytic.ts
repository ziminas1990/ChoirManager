import { Database } from "@src/database.js";
import { ChoristerStatistics } from "@src/entities/statistics.js";
import { IUserAgent } from "@src/interfaces/user_agent.js";
import { Runtime } from "@src/runtime.js";
import { Status } from "@src/status.js";
import { apply_interval } from "@src/utils.js";

export class Analytic {

    static async chorister_statistic_request(agent: IUserAgent, days: number): Promise<Status>
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

        const rehersals = database.get_rehersals_in_period(since, now);
        let rehersals_minutes = 0;
        let visited_minutes = 0;
        let visited_rehersals = 0;
        rehersals.forEach(rehersal => {
            rehersals_minutes += rehersal.duration(user.voice);
            const minutes = rehersal.minutes_of_presence(user_id);
            if (minutes > 0) {
                visited_minutes += minutes;
                visited_rehersals++;
            }
        });

        const statistics: ChoristerStatistics = {
            period: {
                from: since,
                to: now
            },
            total_rehersals: rehersals.length,
            total_hours: rehersals_minutes / 60,
            visited_rehersals: visited_rehersals,
            visited_hours: visited_minutes / 60
        };
        return await agent.as_chorister().send_statistics(statistics);
    }

}